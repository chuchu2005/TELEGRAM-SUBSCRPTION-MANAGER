import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { banChatMember, sendMessage, sendMessageWithKeyboard } from '@/lib/telegram'
import { removeUserMt5Account } from '@/lib/metacopier'
import { ADMIN_ID } from '@/lib/config'

/**
 * GET handler for cron job to remove expired users
 * Open endpoint - no authentication required
 */
export async function GET(request: NextRequest) {
  try {
    // Find all expired subscriptions that haven't been removed yet
    const now = new Date()
    const query: any = {
      where: {
        expiresAt: { lt: now },
        isRemoved: false
      },
      include: { mt5Setup: true }
    }
    const expiredSubscriptions: any[] = await prisma.subscription.findMany(query)

    let removedCount = 0
    let failedCount = 0

    for (const subscription of expiredSubscriptions) {
      try {
        // Check if user has MT5 setup and delete from MetaCopier first
        if (subscription.mt5Setup && subscription.mt5Setup.metacopierAccountId) {
          try {
            console.log(`Removing MetaCopier account ${subscription.mt5Setup.metacopierAccountId} for user ${subscription.telegramUserId}`)
            const result = await removeUserMt5Account(
              subscription.mt5Setup.metacopierAccountId,
              subscription.mt5Setup.metacopierCopierId || ''
            )

            if (result.success) {
              console.log(`Successfully removed MetaCopier account for user ${subscription.telegramUserId}`)
              // Notify admin of successful removal
              await sendMessage(ADMIN_ID, `✅ <b>MetaCopier Account Removed</b>

━━━━━━━━━━━━━━━━━━━

<b>User:</b> ${subscription.telegramUserId} (${subscription.telegramUsername || 'N/A'})
<b>MetaCopier Account:</b> ${subscription.mt5Setup.metacopierAccountId}
<b>Reason:</b> Subscription expired

━━━━━━━━━━━━━━━━━━━

User has been removed from channel and MetaCopier.`)
            } else {
              console.error(`Failed to remove MetaCopier account for user ${subscription.telegramUserId}: ${result.error}`)
              // Notify admin to manually remove
              await sendMessage(ADMIN_ID, `⚠️ <b>MetaCopier Removal Failed - Manual Action Needed!</b>

━━━━━━━━━━━━━━━━━━━

<b>User:</b> ${subscription.telegramUserId} (${subscription.telegramUsername || 'N/A'})
<b>MetaCopier Account:</b> ${subscription.mt5Setup.metacopierAccountId}
<b>MetaCopier Copier:</b> ${subscription.mt5Setup.metacopierCopierId || 'N/A'}
<b>Error:</b> ${result.error}

━━━━━━━━━━━━━━━━━━━

<b>Action Required:</b>
• User has been removed from channel
• But MetaCopier account could NOT be removed automatically
• Please remove manually from MetaCopier dashboard

<b>Login:</b> ${subscription.mt5Setup.loginAccountNumber}
<b>Server:</b> ${subscription.mt5Setup.loginServer}`)
              // Continue with channel removal even if MetaCopier cleanup fails
            }
          } catch (mcError) {
            console.error(`Failed to delete MetaCopier account for user ${subscription.telegramUserId}:`, mcError)
            // Notify admin of error
            await sendMessage(ADMIN_ID, `⚠️ <b>MetaCopier Removal Error - Manual Action Needed!</b>

━━━━━━━━━━━━━━━━━━━

<b>User:</b> ${subscription.telegramUserId} (${subscription.telegramUsername || 'N/A'})
<b>MetaCopier Account:</b> ${subscription.mt5Setup.metacopierAccountId}
<b>Error:</b> ${mcError instanceof Error ? mcError.message : 'Unknown error'}

━━━━━━━━━━━━━━━━━━━

<b>Action Required:</b>
• User has been removed from channel
• But MetaCopier account removal encountered an error
• Please check and remove manually if needed

<b>Login:</b> ${subscription.mt5Setup.loginAccountNumber}
<b>Server:</b> ${subscription.mt5Setup.loginServer}`)
            // Continue with channel removal even if MetaCopier cleanup fails
          }
        }

        // Check if user has ANOTHER active subscription before banning
        const hasOtherActiveSub = await prisma.subscription.findFirst({
          where: {
            telegramUserId: subscription.telegramUserId,
            expiresAt: { gt: now },
            isRemoved: false,
            id: { not: subscription.id }
          }
        })

        if (hasOtherActiveSub) {
          // Just mark this old subscription as removed
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              isRemoved: true,
              removedAt: now
            }
          })

          removedCount++
          console.log(`Silently removed old subscription ${subscription.id} for user ${subscription.telegramUserId} (has another active sub)`)
          continue // Skip the ban and the expiry message
        }

        // Attempt to ban/remove user from channel
        const banned = await banChatMember(subscription.telegramUserId)

        if (banned) {
          // Update subscription as removed
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              isRemoved: true,
              removedAt: now
            }
          })

          // Send notification to user (different message for trials vs paid plans)
          let expiryMessage = ''

          if (subscription.planType === 'trial') {
            expiryMessage = `⏰ <b>Your Free Trial Has Ended!</b>

━━━━━━━━━━━━━━━━━━━

Thank you for trying our VIP signals!

<b>We hope you saw our 96% win rate on XAUUSD!</b>
During your 24-hour trial, you received 3-4 high-quality Gold signals daily.

━━━━━━━━━━━━━━━━━━━

❌ <b>What You're Missing Now:</b>
• No more XAUUSD signals (3-4 daily)
• No more 96% win rate trades
• No entry/exit notifications
• No premium community access

━━━━━━━━━━━━━━━━━━━

💎 <b>UPGRADE NOW & Continue Winning!</b>

Don't lose momentum - get back in the game!

━━━━━━━━━━━━━━━━━━━

🎁 <b>SPECIAL OFFER - 20% OFF!</b>
Because you just completed your trial, we're giving you a 20% discount on ALL plans!
<i>(Valid for the next 24 hours only)</i>

━━━━━━━━━━━━━━━━━━━

💎 Basic: ₦4,000 <s>(was ₦5,000)</s> - 7 days
📊 Bi-Weekly: ₦8,000 <s>(was ₦10,000)</s> - 14 days
📅 Monthly: ₦12,000 <s>(was ₦15,000)</s> - 30 days
👑 Premium: ₦17,600 <s>(was ₦22,000)</s> - 14 days + Copier

━━━━━━━━━━━━━━━━━━━

<b>Quick Upgrade:</b> Type /pay

Or use this button to upgrade now!`
          } else {
            expiryMessage = `⏰ <b>Your subscription has expired.</b>

━━━━━━━━━━━━━━━━━━━

Your access to Pear VIP signals channel has been removed.

━━━━━━━━━━━━━━━━━━━

<b>Want to renew?</b>
Just tap the button below to make a new payment!

💎 Basic: ₦5,000 (7 days)
📊 Bi-Weekly: ₦10,000 (14 days)
📅 Monthly: ₦15,000 (30 days)
👑 Premium: ₦22,000 (14 days + Copier)

━━━━━━━━━━━━━━━━━━━

Or type /pay to get started.`
          }

          if (subscription.planType === 'trial') {
            await sendMessageWithKeyboard(
              subscription.telegramUserId,
              expiryMessage,
              {
                inline_keyboard: [[
                  { text: '💳 Upgrade Now (20% OFF)', callback_data: 'pay' }
                ]]
              }
            )
          } else {
            await sendMessageWithKeyboard(
              subscription.telegramUserId,
              expiryMessage,
              {
                inline_keyboard: [[
                  { text: '💳 Renew Subscription', callback_data: 'pay' }
                ]]
              }
            )
          }

          removedCount++
          console.log(`Removed user ${subscription.telegramUserId} (subscription ${subscription.id})`)
        } else {
          failedCount++
          console.error(`Failed to ban user ${subscription.telegramUserId}`)
        }
      } catch (error) {
        failedCount++
        console.error(`Error removing subscription ${subscription.id}:`, error)
        // Don't mark as removed - will retry on next cron run
      }
    }

    return NextResponse.json({
      success: true,
      processed: expiredSubscriptions.length,
      removed: removedCount,
      failed: failedCount,
      timestamp: now.toISOString()
    })
  } catch (error) {
    console.error('Error in cron job:', error)
    return NextResponse.json(
      {
        error: 'Cron job failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

// Allow POST for testing
export async function POST(request: NextRequest) {
  return GET(request)
}
