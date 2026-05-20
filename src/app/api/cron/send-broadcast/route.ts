import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMessageWithKeyboard, createInviteLink, unbanChatMember, sendMessage } from '@/lib/telegram'
import { BROADCAST_MESSAGES, calculateExpiryDate, PLANS, ADMIN_ID } from '@/lib/config'
import { createHash } from 'crypto'

/**
 * GET handler for broadcast cron job
 * Sends broadcast messages to all users based on time (8am or 10am Nigerian)
 * Query parameter: ?hour=8 or ?hour=10
 */

export async function GET(request: NextRequest) {
  try {
    const now = new Date()
    const searchParams = request.nextUrl.searchParams
    const hourParam = searchParams.get('hour') || '8' // Default to 8am if no hour provided

    // Validate hour parameter
    const validHours = ['8', '10'] as const
    if (!validHours.includes(hourParam as any)) {
      return NextResponse.json({
        error: 'Invalid hour parameter',
        message: 'Hour must be 8 or 10'
      }, { status: 400 })
    }

    const hour = hourParam as '8' | '10'
    const message = BROADCAST_MESSAGES[hour]

    console.log(`[Broadcast Cron] Starting ${hour}am broadcast at ${now.toISOString()}`)

    // Get all users from User table (no time filter - send to all users including inactive ones)
    const uniqueUsers = await prisma.user.findMany({
      select: {
        telegramUserId: true,
        telegramUsername: true,
        telegramName: true
      }
    })

    console.log(`[Broadcast Cron] Found ${uniqueUsers.length} users to send broadcast to`)

    let processedCount = 0
    let sentCount = 0
    let failedCount = 0
    let skippedCount = 0

    // Process each user
    for (const user of uniqueUsers) {
      const userId = user.telegramUserId

      try {
        // Skip admin
        if (userId === ADMIN_ID.toString()) {
          console.log(`[Broadcast Cron] Skipping admin user ${userId}`)
          skippedCount++
          continue
        }

        // Check for 24-hour deduplication for THIS specific message hour
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        const recentBroadcast = await prisma.broadcastLog.findFirst({
          where: {
            telegramUserId: userId,
            messageHour: hour,
            sentAt: { gte: twentyFourHoursAgo }
          }
        })

        if (recentBroadcast) {
          console.log(`[Broadcast Cron] Skipping user ${userId} - sent ${hour}am broadcast within last 24 hours`)
          skippedCount++
          continue
        }

        // Send broadcast message with button to ALL users
        console.log(`[Broadcast Cron] Sending broadcast to user ${userId}`)

        await sendMessageWithKeyboard(
          userId,
          message.text,
          {
            inline_keyboard: [
              [
                { text: message.buttonText, callback_data: 'broadcast_pay' }
              ]
            ]
          }
        )

        // Log broadcast
        await prisma.broadcastLog.create({
          data: {
            messageHash: createHash('md5').update(`${hour}_${userId}_${Date.now()}`).digest('hex'),
            telegramUserId: userId,
            message: message.text,
            messageHour: hour,
            action: 'broadcast_sent'
          }
        })

        sentCount++
        console.log(`[Broadcast Cron] Sent broadcast to user ${userId}`)

        processedCount++

        // Rate limiting: 100ms delay between messages
        await new Promise(resolve => setTimeout(resolve, 100))

      } catch (error) {
        failedCount++
        console.error(`[Broadcast Cron] Error processing user ${userId}:`, error)
        // Continue processing other users
      }
    }

    console.log(`[Broadcast Cron] Completed ${hour}am broadcast. Processed=${processedCount}, Sent=${sentCount}, Failed=${failedCount}, Skipped=${skippedCount}`)

    // Send summary to admin
    try {
      const summaryMessage = `📊 <b>Broadcast Summary - ${hour} AM Nigerian Time</b>

━━━━━━━━━━━━━━━━━━━

✅ <b>Successfully Sent:</b> ${sentCount}
❌ <b>Failed:</b> ${failedCount}
⏭️ <b>Skipped:</b> ${skippedCount}
📝 <b>Total Processed:</b> ${processedCount}

━━━━━━━━━━━━━━━━━━━

<b>Timestamp:</b> ${now.toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}

<i>${failedCount > 0 ? '⚠️ Some messages failed. Check logs for details.' : '✨ All messages sent successfully!'}</i>`

      await sendMessage(ADMIN_ID.toString(), summaryMessage)
      console.log('[Broadcast Cron] Summary sent to admin')
    } catch (error) {
      console.error('[Broadcast Cron] Failed to send summary to admin:', error)
    }

    return NextResponse.json({
      success: true,
      hour,
      processed: processedCount,
      sent: sentCount,
      failed: failedCount,
      skipped: skippedCount,
      timestamp: now.toISOString()
    })

  } catch (error) {
    console.error('[Broadcast Cron] Error in cron job:', error)
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