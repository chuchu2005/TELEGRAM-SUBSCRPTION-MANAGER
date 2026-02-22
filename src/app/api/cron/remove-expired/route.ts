import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { banChatMember, sendMessage } from '@/lib/telegram'
import { removeUserMt5Account } from '@/lib/metacopier'

/**
 * GET handler for cron job to remove expired users
 * Open endpoint - no authentication required
 */
export async function GET(request: NextRequest) {
  try {
    // Find all expired subscriptions that haven't been removed yet
    const now = new Date()
    const expiredSubscriptions = await prisma.subscription.findMany({
      where: {
        expiresAt: { lt: now },
        isRemoved: false
      },
      include: { mt5Setup: true }
    }) as any

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
            } else {
              console.error(`Failed to remove MetaCopier account for user ${subscription.telegramUserId}: ${result.error}`)
              // Continue with channel removal even if MetaCopier cleanup fails
            }
          } catch (mcError) {
            console.error(`Failed to delete MetaCopier account for user ${subscription.telegramUserId}:`, mcError)
            // Continue with channel removal even if MetaCopier cleanup fails
          }
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

          // Send notification to user
          await sendMessage(
            subscription.telegramUserId,
            `⏰ <b>Your subscription has expired.</b>

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
          )

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
