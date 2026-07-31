import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMessage, sendMessageWithKeyboard } from '@/lib/telegram'
import { ADMIN_ID } from '@/lib/config'
import { generateMessageHash, hasReceivedMessageRecently, logBroadcastMessage, runBounded } from '@/lib/broadcast'

/**
 * POST /api/admin/broadcast
 * Send a marketing message to all users
 */
export async function POST(request: NextRequest) {
  try {

    // Parse request body
    const body = await request.json()
    const { message, planType, activeOnly, replyMarkup, testMode, testUserId } = body

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // If test mode, send only to specified user or admin
    if (testMode) {
      const targetUserId = testUserId || ADMIN_ID
      const sent = replyMarkup
        ? await sendMessageWithKeyboard(targetUserId, message, replyMarkup)
        : await sendMessage(targetUserId, message)

      return NextResponse.json({
        success: sent,
        message: sent ? 'Test broadcast sent successfully' : 'Failed to send test message',
        testUser: targetUserId
      })
    }

    // Build query for recipients
    let whereClause: any = {}

    // Filter by plan type if specified
    if (planType && planType !== 'all') {
      whereClause.planType = planType
    }

    // Filter only active subscriptions if specified
    if (activeOnly) {
      whereClause.expiresAt = { gt: new Date() }
      whereClause.isRemoved = false
    }

    // Get all unique telegram user IDs
    const subscriptions = await prisma.subscription.findMany({
      where: whereClause,
      select: {
        telegramUserId: true,
        telegramUsername: true
      },
      distinct: ['telegramUserId']
    })

    // Handle empty recipient list
    if (subscriptions.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No users match the specified criteria'
      }, { status: 400 })
    }

    console.log(`Sending broadcast to ${subscriptions.length} users`)

    // Generate message hash once for all recipients
    const messageHash = generateMessageHash(message)

    // Send message to each user
    let successCount = 0
    let failedCount = 0
    let duplicateCount = 0
    const failedUsers: string[] = []

    // Send message to each user with bounded concurrency (replaces sequential loop + sleeps)
    await runBounded(subscriptions, async (subscription) => {
      // Check for duplicate (deduplication)
      const hasReceived = await hasReceivedMessageRecently(subscription.telegramUserId, messageHash)
      if (hasReceived) {
        duplicateCount++
        console.log(`[Broadcast API] Skipped duplicate for user ${subscription.telegramUserId}`)
        return
      }

      // Helper to send to this user (used for initial attempt + 429 retry)
      const sendToUser = (): Promise<boolean> => {
        if (replyMarkup) {
          return sendMessageWithKeyboard(subscription.telegramUserId, message, replyMarkup)
        }
        return sendMessage(subscription.telegramUserId, message)
      }

      try {
        let sent: boolean
        try {
          sent = await sendToUser()
        } catch (error: any) {
          // Handle Telegram rate limit (429 error) - wait, then retry this user once
          if (error?.response?.status === 429) {
            const retryAfter = error.response.data?.retry_after || 30
            console.warn(`[Broadcast API] Rate limited, waiting ${retryAfter}s`)
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
            sent = await sendToUser()
          } else {
            throw error
          }
        }

        if (sent) {
          successCount++
          // Log successful send to database
          try {
            await logBroadcastMessage(subscription.telegramUserId, messageHash)
          } catch (logError) {
            // Don't stop broadcast - message was already sent
            console.error(`Failed to log broadcast for user ${subscription.telegramUserId}:`, logError)
          }
        } else {
          failedCount++
          failedUsers.push(subscription.telegramUsername || subscription.telegramUserId.toString())
        }
      } catch (error: any) {
        // Handle other errors (including a second failure on 429 retry)
        failedCount++
        failedUsers.push(subscription.telegramUsername || subscription.telegramUserId.toString())
        console.error(`Failed to send to ${subscription.telegramUserId}:`, error)
      }
    }, 8)

    return NextResponse.json({
      success: true,
      message: 'Broadcast sent successfully',
      stats: {
        total: subscriptions.length,
        successful: successCount,
        failed: failedCount,
        skipped: duplicateCount,
        failedUsers
      }
    })
  } catch (error) {
    console.error('Error in broadcast API:', error)
    return NextResponse.json(
      {
        error: 'Broadcast failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

// Allow GET for testing (will show usage info)
export async function GET(request: NextRequest) {

  // Get subscriber stats
  const totalSubscribers = await prisma.subscription.groupBy({
    by: ['planType'],
    _count: {
      telegramUserId: true
    }
  })

  const activeSubscribers = await prisma.subscription.groupBy({
    by: ['planType'],
    where: {
      expiresAt: { gt: new Date() },
      isRemoved: false
    },
    _count: {
      telegramUserId: true
    }
  })

  const totalUsers = await prisma.subscription.findMany({
    select: { telegramUserId: true },
    distinct: ['telegramUserId']
  })

  return NextResponse.json({
    info: 'Broadcast API - Send messages to all users',
    usage: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        message: 'Your message here (supports HTML formatting)',
        planType: 'basic | monthly | premium | all (optional, default: all)',
        activeOnly: 'true | false (optional, default: false)',
        replyMarkup: '{ inline_keyboard: [[{ text: "Button", url: "https://..." }]] } (optional)',
        testMode: 'true | false (optional, default: false) - Send test message to admin only',
        testUserId: 'number (optional, default: admin ID) - Send test message to specific user ID'
      },
      examples: [
        {
          description: 'Send test message to admin',
          curl: `curl -X POST https://your-domain.com/api/admin/broadcast \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Test message", "testMode": true}'`
        },
        {
          description: 'Send to all users',
          curl: `curl -X POST https://your-domain.com/api/admin/broadcast \\
  -H "Content-Type: application/json" \\
  -d '{"message": "🎉 Special offer! 20% off all plans this week!"}'`
        }
      ]
    },
    stats: {
      totalUniqueUsers: totalUsers.length,
      totalSubscribers: totalSubscribers,
      activeSubscribers
    }
  })
}
