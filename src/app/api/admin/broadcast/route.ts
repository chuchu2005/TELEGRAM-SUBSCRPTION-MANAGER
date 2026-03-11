import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMessage, sendMessageWithKeyboard } from '@/lib/telegram'
import { ADMIN_ID } from '@/lib/config'

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

    console.log(`Sending broadcast to ${subscriptions.length} users`)

    // Send message to each user
    let successCount = 0
    let failedCount = 0
    const failedUsers: string[] = []

    for (const subscription of subscriptions) {
      try {
        let sent: boolean
        if (replyMarkup) {
          sent = await sendMessageWithKeyboard(subscription.telegramUserId, message, replyMarkup)
        } else {
          sent = await sendMessage(subscription.telegramUserId, message)
        }

        if (sent) {
          successCount++
        } else {
          failedCount++
          failedUsers.push(subscription.telegramUsername || subscription.telegramUserId.toString())
        }
      } catch (error) {
        failedCount++
        failedUsers.push(subscription.telegramUsername || subscription.telegramUserId.toString())
        console.error(`Failed to send to ${subscription.telegramUserId}:`, error)
      }

      // Add small delay to avoid rate limiting (20 messages per second limit)
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    return NextResponse.json({
      success: true,
      message: 'Broadcast sent successfully',
      stats: {
        total: subscriptions.length,
        successful: successCount,
        failed: failedCount,
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
