import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { banChatMember, sendMessage } from '@/lib/telegram'

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
      }
    })

    let removedCount = 0
    let failedCount = 0

    for (const subscription of expiredSubscriptions) {
      try {
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
