import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMessageWithKeyboard, createInviteLink, unbanChatMember } from '@/lib/telegram'
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
    let trialCreatedCount = 0
    let sentToExistingCount = 0
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

        // Check for 24-hour deduplication
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        const recentBroadcast = await prisma.broadcastLog.findFirst({
          where: {
            telegramUserId: userId,
            sentAt: { gte: twentyFourHoursAgo }
          }
        })

        if (recentBroadcast) {
          console.log(`[Broadcast Cron] Skipping user ${userId} - sent broadcast within last 24 hours`)
          skippedCount++
          continue
        }

        // Check trial eligibility: count ANY previous subscription (trial OR paid)
        const previousSubsCount = await prisma.subscription.count({
          where: {
            telegramUserId: userId
          }
        })

        console.log(`[Broadcast Cron] User ${userId} has ${previousSubsCount} previous subscription(s)`)

        if (previousSubsCount === 0) {
          // New user - create trial and send invite link
          console.log(`[Broadcast Cron] Creating trial for new user ${userId}`)

          // Always unban user before creating invite link (safety measure)
          await unbanChatMember(userId)
          console.log(`[Broadcast Cron] Unbanned user ${userId} before sending invite link`)

          // Create invite link
          const inviteLink = await createInviteLink()

          if (!inviteLink) {
            console.error(`[Broadcast Cron] Failed to create invite link for user ${userId}`)
            failedCount++
            continue
          }

          // Create trial subscription
          const expiresAt = new Date()
          expiresAt.setHours(expiresAt.getHours() + 24) // 24 hours from now

          await prisma.subscription.create({
            data: {
              telegramUserId: userId,
              telegramUsername: user.telegramUsername || null,
              telegramName: user.telegramName || 'User',
              paystackRef: `BROADCAST_TRIAL_${Date.now()}_${userId}`,
              amountKobo: 0,
              planType: 'trial',
              hasCopierAccess: false,
              startedAt: new Date(),
              expiresAt,
              inviteLinkUsed: inviteLink
            }
          })

          // Log broadcast
          await prisma.broadcastLog.create({
            data: {
              messageHash: createHash('md5').update(`${hour}_${userId}_${Date.now()}`).digest('hex'),
              telegramUserId: userId,
              message: message.text,
              messageHour: hour,
              action: 'trial_created'
            }
          })

          // Send trial welcome message
          await sendMessageWithKeyboard(
            userId,
            `🎁 <b>Your 24-Hour Free Trial is Ready!</b>\n\n` +
            `━━━━━━━━━━━━━━━━━━━\n\n` +
            `You've been granted a 24-hour trial to our VIP signals group!\n\n` +
            `<b>📋 What you'll get:</b>\n` +
            `• Premium XAUUSD trading signals\n` +
            `• Real-time trade entries & exits\n` +
            `• Risk management guidance\n\n` +
            `<b>🔗 Join the VIP Group:</b>\n` +
            `${inviteLink}\n\n` +
            `━━━━━━━━━━━━━━━━━━━\n\n` +
            `<b>⏰ Trial expires in 24 hours</b>\n\n` +
            `Upgrade now to continue receiving our signals!`,
            {
              inline_keyboard: [
                [
                  { text: '💳 Upgrade Now', callback_data: 'broadcast_pay' }
                ]
              ]
            }
          )

          trialCreatedCount++
          console.log(`[Broadcast Cron] Created trial for user ${userId}`)

        } else {
          // Existing user - send broadcast message with payment button
          console.log(`[Broadcast Cron] Sending broadcast to existing user ${userId}`)

          // Send broadcast message with button
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

          sentToExistingCount++
          console.log(`[Broadcast Cron] Sent broadcast to existing user ${userId}`)
        }

        processedCount++

        // Rate limiting: 100ms delay between messages
        await new Promise(resolve => setTimeout(resolve, 100))

      } catch (error) {
        failedCount++
        console.error(`[Broadcast Cron] Error processing user ${userId}:`, error)
        // Continue processing other users
      }
    }

    console.log(`[Broadcast Cron] Completed ${hour}am broadcast. Processed=${processedCount}, TrialCreated=${trialCreatedCount}, SentToExisting=${sentToExistingCount}, Failed=${failedCount}, Skipped=${skippedCount}`)

    return NextResponse.json({
      success: true,
      hour,
      processed: processedCount,
      trialCreated: trialCreatedCount,
      sentToExisting: sentToExistingCount,
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