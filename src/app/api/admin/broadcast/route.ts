import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMessage } from '@/lib/telegram'

const ADMIN_SECRET = process.env.ADMIN_SECRET!

/**
 * POST /api/admin/broadcast
 * Send a marketing message to all users
 * Protected by ADMIN_SECRET in Authorization header
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin secret
    const authHeader = request.headers.get('authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)

    if (token !== ADMIN_SECRET) {
      console.error('Invalid admin secret provided')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse request body
    const body = await request.json()
    const { message, planType, activeOnly } = body

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
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
        const sent = await sendMessage(subscription.telegramUserId, message)
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
  const authHeader = request.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = authHeader.substring(7)

  if (token !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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
        'Authorization': 'Bearer YOUR_ADMIN_SECRET'
      },
      body: {
        message: 'Your message here (supports HTML formatting)',
        planType: 'basic | monthly | premium | all (optional, default: all)',
        activeOnly: 'true | false (optional, default: false)'
      },
      examples: [
        {
          description: 'Send to all users',
          curl: `curl -X POST https://your-domain.com/api/admin/broadcast \\
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "🎉 Special offer! 20% off all plans this week!"}'`
        },
        {
          description: 'Send to active premium users only',
          curl: `curl -X POST https://your-domain.com/api/admin/broadcast \\
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Exclusive for Premium members!", "planType": "premium", "activeOnly": true}'`
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
