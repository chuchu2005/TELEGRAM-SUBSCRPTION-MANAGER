import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMessage, sendMessageWithKeyboard, formatDate } from '@/lib/telegram'
import { PLANS } from '@/lib/config'

/**
 * GET handler for cron job to send renewal reminders
 * Handles both paid plan reminders (2 days before) and trial reminders (6 hours before)
 */
export async function GET(request: NextRequest) {
  try {
    const now = new Date()
    let reminderCount = 0

    // ─────────────────────────────────────────────────────────────
    // 1. TRIAL REMINDERS: Send when trial has 6 hours left
    // ─────────────────────────────────────────────────────────────
    const trialWindow6hStart = new Date(now.getTime() + 5.5 * 60 * 60 * 1000) // 5.5 hours from now
    const trialWindow6hEnd = new Date(now.getTime() + 6.5 * 60 * 60 * 1000) // 6.5 hours from now

    const trialSubscriptions = await prisma.subscription.findMany({
      where: {
        planType: 'trial',
        expiresAt: {
          gte: trialWindow6hStart,
          lte: trialWindow6hEnd
        },
        isRemoved: false
      }
    })

    for (const subscription of trialSubscriptions) {
      try {
        const hoursLeft = Math.ceil((subscription.expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000))

        const message = `⏰ <b>Your free trial ends in ~${hoursLeft} hours!</b>

━━━━━━━━━━━━━━━━━━━

You have been seeing our XAUUSD signals — the same signals that have been hitting 96% win rate consistently.

Those signals stop when your trial ends.

━━━━━━━━━━━━━━━━━━━

🔥 <b>HERE IS YOUR EXCLUSIVE OFFER:</b>

Because you tried us out, we're giving you <b>20% OFF</b> to upgrade today.

This discount disappears in <b>24 hours</b> after your trial ends. After that, prices go back to normal — no exceptions.

💎 Basic → <b>₦8,000</b> <s>(usually ₦10,000)</s> — 7 days
📊 Bi-Weekly → <b>₦13,600</b> <s>(usually ₦17,000)</s> — 14 days
📅 Monthly → <b>₦28,000</b> <s>(usually ₦35,000)</s> — 30 days
👑 Premium → <b>₦17,600</b> <s>(usually ₦22,000)</s> — 14 days + Auto Copier

━━━━━━━━━━━━━━━━━━━

Every day you wait is a day you're missing signals and money.

Tap below to lock in your discount before it's gone.`

        await sendMessageWithKeyboard(subscription.telegramUserId, message, {
          inline_keyboard: [
            [
              { text: '🔥 Upgrade Now — 20% OFF (24hrs only)', callback_data: 'pay' }
            ]
          ]
        })

        reminderCount++
        console.log(`Sent 6-hour trial reminder to user ${subscription.telegramUserId}`)
      } catch (error) {
        console.error(`Error sending trial reminder to user ${subscription.telegramUserId}:`, error)
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 2. PAID PLAN REMINDERS: Send when subscription has ~2 days left
    // ─────────────────────────────────────────────────────────────
    const reminderDate = new Date(now)
    reminderDate.setDate(reminderDate.getDate() + 2)
    reminderDate.setHours(0, 0, 0, 0) // Start of day in 2 days

    const reminderDateEnd = new Date(reminderDate)
    reminderDateEnd.setHours(23, 59, 59, 999) // End of that day

    const paidSubscriptions = await prisma.subscription.findMany({
      where: {
        planType: { not: 'trial' },
        expiresAt: {
          gte: reminderDate,
          lte: reminderDateEnd
        },
        isRemoved: false
      }
    })

    for (const subscription of paidSubscriptions) {
      try {
        const plan = PLANS[subscription.planType as keyof typeof PLANS]
        const planName = plan?.name || subscription.planType
        const formattedExpiry = formatDate(subscription.expiresAt)
        const daysRemaining = Math.ceil((subscription.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

        const message = `⏰ <b>Your subscription expires in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}!</b>

━━━━━━━━━━━━━━━━━━━

<b>Plan:</b> ${planName}
<b>Expires:</b> ${formattedExpiry}

━━━━━━━━━━━━━━━━━━━

Don't let your VIP access go. Our signals keep hitting — make sure you're in the channel when they drop.

Tap below to renew and keep your access going without any break.`

        await sendMessageWithKeyboard(subscription.telegramUserId, message, {
          inline_keyboard: [[
            { text: '💳 Renew My Subscription', callback_data: 'pay' }
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
      trialReminders: trialSubscriptions.length,
      paidReminders: paidSubscriptions.length,
      sent: reminderCount,
      timestamp: now.toISOString()
    })
  } catch (error) {
    console.error('Error in reminder cron job:', error)
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
