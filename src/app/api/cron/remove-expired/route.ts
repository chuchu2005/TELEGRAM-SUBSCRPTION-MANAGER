import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { banChatMember, sendMessage, sendMessageWithKeyboard, getChatMember } from '@/lib/telegram'
import { removeUserMt5Account } from '@/lib/metacopier'
import { ADMIN_ID, PLANS } from '@/lib/config'

const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID!

/**
 * GET handler for cron job to remove expired users
 * Open endpoint - no authentication required
 */
export async function GET(request: NextRequest) {
  try {
    console.log(`[Remove Expired Cron] Starting at ${new Date().toISOString()}`)

    // Find all expired subscriptions that haven't been removed yet
    const now = new Date()
    console.log(`[Remove Expired Cron] Current time: ${now.toISOString()}`)

    // Step 1: Process expired subscriptions not marked as removed
    const query: any = {
      where: {
        expiresAt: { lt: now },
        isRemoved: false
      },
      include: { mt5Setup: true }
    }
    const expiredSubscriptions: any[] = await prisma.subscription.findMany(query)

    console.log(`[Remove Expired Cron] Found ${expiredSubscriptions.length} expired subscriptions to process`)

    // Step 2: Verify users marked as removed are actually gone
    // Find subscriptions marked as removed within the last 7 days to verify
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const verificationQuery: any = {
      where: {
        isRemoved: true,
        removedAt: { gte: sevenDaysAgo }
      }
    }
    const subscriptionsToVerify: any[] = await prisma.subscription.findMany(verificationQuery)

    console.log(`[Remove Expired Cron] Found ${subscriptionsToVerify.length} subscriptions to verify`)

    let removedCount = 0
    let failedCount = 0
    let verifiedCount = 0
    let verificationFailedCount = 0

    for (const subscription of expiredSubscriptions) {
      console.log(`[Remove Expired Cron] Processing subscription ${subscription.id} for user ${subscription.telegramUserId}, plan: ${subscription.planType}, expired: ${subscription.expiresAt.toISOString()}`)
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

        console.log(`[Remove Expired Cron] User ${subscription.telegramUserId} has other active sub: ${!!hasOtherActiveSub}`)

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

        // Safety: Never ban admins
        if (subscription.telegramUserId === ADMIN_ID.toString()) {
          console.log(`Skipping ban for admin user ${subscription.telegramUserId}`)
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: { isRemoved: true, removedAt: now }
          })
          removedCount++
          continue
        }

        // Attempt to ban/remove user from channel
        console.log(`[Remove Expired Cron] Attempting to ban user ${subscription.telegramUserId} from channel`)
        const banned = await banChatMember(subscription.telegramUserId)
        console.log(`[Remove Expired Cron] Ban result for user ${subscription.telegramUserId}: ${banned}`)

        if (banned) {
          // Mark subscription as removed only if ban succeeded
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
            // Calculate 15% discount prices dynamically
            const discountBasic = Math.round(PLANS.basic.amountKobo * 0.85 / 100)
            const discountBiweekly = Math.round(PLANS.biweekly.amountKobo * 0.85 / 100)
            const discountMonthly = Math.round(PLANS.monthly.amountKobo * 0.85 / 100)

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

🎁 <b>SPECIAL OFFER - 15% OFF!</b>
Because you just completed your trial, we're giving you a 15% discount on ALL plans!
<i>(Valid for the next 24 hours only)</i>

━━━━━━━━━━━━━━━━━━━

💎 Basic: ₦${discountBasic.toLocaleString()} <s>(was ₦${(PLANS.basic.amountKobo / 100).toLocaleString()})</s> - 7 days
📊 Bi-Weekly: ₦${discountBiweekly.toLocaleString()} <s>(was ₦${(PLANS.biweekly.amountKobo / 100).toLocaleString()})</s> - 14 days
📅 Monthly: ₦${discountMonthly.toLocaleString()} <s>(was ₦${(PLANS.monthly.amountKobo / 100).toLocaleString()})</s> - 30 days

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

💎 Basic: ₦${(PLANS.basic.amountKobo / 100).toLocaleString()} (7 days)
📊 Bi-Weekly: ₦${(PLANS.biweekly.amountKobo / 100).toLocaleString()} (14 days)
📅 Monthly: ₦${(PLANS.monthly.amountKobo / 100).toLocaleString()} (30 days)

━━━━━━━━━━━━━━━━━━━

Or type /pay to get started.`
          }

          if (subscription.planType === 'trial') {
            await sendMessageWithKeyboard(
              subscription.telegramUserId,
              expiryMessage,
              {
                inline_keyboard: [[
                  { text: '💳 Upgrade Now (15% OFF)', callback_data: 'pay' }
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
          // Ban failed - don't mark as removed so it will be retried on next run
          failedCount++
          console.error(`Failed to ban user ${subscription.telegramUserId}, will retry on next run`)
        }
      } catch (error) {
        failedCount++
        console.error(`Error removing subscription ${subscription.id}:`, error)
        // Subscription not marked as removed, will be retried on next run
      }
    }

    console.log(`[Remove Expired Cron] Completed processing expired subscriptions. Now verifying removed users...`)

    // Step 3: Verify users marked as removed are actually gone
    for (const subscription of subscriptionsToVerify) {
      const userId = subscription.telegramUserId

      try {
        const response = await getChatMember(userId, CHANNEL_ID)
        const status = response.result?.status || 'error'
        const isActuallyRemoved = !['member', 'administrator', 'creator'].includes(status)

        if (isActuallyRemoved) {
          verifiedCount++
          console.log(`[Remove Expired Cron] Verified user ${userId} is actually removed (status: ${status})`)
        } else {
          // User is still in channel! Check if they have an active subscription before banning
          const hasOtherActiveSub = await prisma.subscription.findFirst({
            where: {
              telegramUserId: userId,
              expiresAt: { gt: now },
              isRemoved: false,
              id: { not: subscription.id }
            }
          })

          if (hasOtherActiveSub) {
            // User has an active subscription - just mark this one as removed
            await prisma.subscription.update({
              where: { id: subscription.id },
              data: {
                isRemoved: true,
                removedAt: now
              }
            })
            verifiedCount++
            console.log(`[Remove Expired Cron] Verified user ${userId} has active subscription - marked old sub as removed`)
          } else {
            // No active subscription - this is a ghost user, ban them
            verificationFailedCount++
            console.log(`[Remove Expired Cron] VERIFICATION FAILED: User ${userId} is still in channel (status: ${status}) - resetting for retry`)

            await prisma.subscription.update({
              where: { id: subscription.id },
              data: {
                isRemoved: false,
                removedAt: null
              }
            })

            // Try to ban now
            const banned = await banChatMember(userId)
            if (banned) {
              await prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                  isRemoved: true,
                  removedAt: now
                }
              })
              console.log(`[Remove Expired Cron] Successfully removed ghost user ${userId} during verification`)
            } else {
              console.log(`[Remove Expired Cron] Ban failed for ghost user ${userId}, will retry next run`)
            }
          }
        }
      } catch (error) {
        console.error(`Error verifying user ${userId}:`, error)
      }
    }

    console.log(`[Remove Expired Cron] Summary: Processed=${expiredSubscriptions.length}, Removed=${removedCount}, Failed=${failedCount}, Verified=${verifiedCount}, VerificationFailed=${verificationFailedCount}`)

    return NextResponse.json({
      success: true,
      processed: expiredSubscriptions.length,
      removed: removedCount,
      failed: failedCount,
      verified: verifiedCount,
      verificationFailed: verificationFailedCount,
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
