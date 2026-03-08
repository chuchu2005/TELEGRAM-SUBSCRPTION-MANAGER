import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMessageWithKeyboard, formatDate } from '@/lib/telegram'
import { PLANS } from '@/lib/config'

/**
 * GET handler for cron job to send renewal reminders
 * Open endpoint - no authentication required
 */
export async function GET(request: NextRequest) {
  try {
    // Calculate the date that is exactly 2 days from now
    const now = new Date()
    const reminderDate = new Date(now)
    reminderDate.setDate(reminderDate.getDate() + 2)
    reminderDate.setHours(0, 0, 0, 0) // Start of the day

    const reminderDateEnd = new Date(reminderDate)
    reminderDateEnd.setHours(23, 59, 59, 999) // End of the day

    // Find all subscriptions expiring in exactly 2 days
    const subscriptionsToRemind = await prisma.subscription.findMany({
      where: {
        expiresAt: {
          gte: reminderDate,
          lte: reminderDateEnd
        },
        isRemoved: false
      }
    })

    let reminderCount = 0

    for (const subscription of subscriptionsToRemind) {
      try {
        const plan = PLANS[subscription.planType as keyof typeof PLANS]
        const planName = plan?.name || subscription.planType
        const formattedExpiry = formatDate(subscription.expiresAt)
        const daysRemaining = Math.ceil((subscription.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

        const message = `⏰ <b>Your Subscription Expires Soon!</b>

━━━━━━━━━━━━━━━━━━━

<b>Plan:</b> ${planName}
<b>Expires:</b> ${formattedExpiry}
<b>Days Remaining:</b> ${daysRemaining} days

━━━━━━━━━━━━━━━━━━━

<b>Don't lose your access!</b>
Renew now to keep receiving VIP signals and avoid any interruption.`

        // Send with quick renewal button
        await sendMessageWithKeyboard(subscription.telegramUserId, message, {
          inline_keyboard: [[
            { text: '💳 Quick Renew', callback_data: 'quick_renew' }
          ]]
        })

        reminderCount++
        console.log(`Sent renewal reminder to user ${subscription.telegramUserId}`)
      } catch (error) {
        console.error(`Error sending reminder to user ${subscription.telegramUserId}:`, error)
      }
    }

    return NextResponse.json({
      success: true,
      total: subscriptionsToRemind.length,
      sent: reminderCount,
      timestamp: now.toISOString()
    })
  } catch (error) {
    console.error('Error in renewal reminder cron job:', error)
    return NextResponse.json(
      {
        error: 'Reminder cron job failed',
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
