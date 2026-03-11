import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMessage } from '@/lib/telegram'
import { ADMIN_ID, TRADE_STATS_CONFIG } from '@/lib/config'
import { generateTradeStatistics, formatStatsMessage } from '@/lib/trade-stats'

/**
 * Daily Bot Statistics API Endpoint
 * This endpoint collects and sends daily bot stats to the admin.
 * Designed to be triggered by any cron service (cron-job.org, Vercel, etc.)
 */
export async function POST(request: NextRequest) {
  try {

    // Collect daily statistics
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)

    // 1. Total unique bot users
    const totalUsers = await prisma.user.count()

    // 2. Total unique subscribers
    const uniqueSubscribers = await prisma.subscription.groupBy({
      by: ['telegramUserId'],
    })

    // 3. Active subscribers
    const activeSubscribers = await prisma.subscription.count({
      where: {
        expiresAt: { gt: now },
        isRemoved: false
      }
    })

    // 4. New users today
    const newUsersToday = await prisma.user.count({
      where: {
        createdAt: {
          gte: new Date(now.setHours(0, 0, 0, 0)) // Start of today
        }
      }
    })

    // 5. New subscribers today
    const newSubscribersToday = await prisma.subscription.count({
      where: {
        createdAt: {
          gte: new Date(now.setHours(0, 0, 0, 0)) // Start of today
        }
      }
    })

    // 6. Premium users with MT5 Setup
    const premiumWithSetup = await prisma.mt5Setup.count()

    // 7. Total Revenue
    const totalRevenue = await prisma.subscription.aggregate({
      _sum: {
        amountKobo: true
      }
    })
    const revenueNaira = (totalRevenue._sum.amountKobo || 0) / 100

    // 8. Revenue today
    const revenueToday = await prisma.subscription.aggregate({
      where: {
        createdAt: {
          gte: new Date(now.setHours(0, 0, 0, 0)) // Start of today
        }
      },
      _sum: {
        amountKobo: true
      }
    })
    const revenueNairaToday = (revenueToday._sum.amountKobo || 0) / 100

    // 9. Total subscriptions (all time)
    const totalSubscriptions = await prisma.subscription.count()

    // 10. Expired subscriptions count
    const expiredSubscriptions = await prisma.subscription.count({
      where: {
        expiresAt: { lt: now },
        isRemoved: false
      }
    })

    // 11. Get latest active subscribers (limit to 10)
    const latestSubs = await prisma.subscription.findMany({
      where: {
        expiresAt: { gt: now },
        isRemoved: false
      },
      orderBy: { startedAt: 'desc' },
      take: 10,
      select: {
        telegramName: true,
        telegramUsername: true,
        expiresAt: true,
        planType: true,
        startedAt: true
      }
    })

    // 12. Generate trade statistics if enabled
    let statsSection = ''
    if (TRADE_STATS_CONFIG.enabled) {
      const stats = generateTradeStatistics()
      statsSection = formatStatsMessage(stats)
    }

    // Format latest subscribers list
    let subsList = ''
    if (latestSubs.length > 0) {
      subsList = '\n\n📅 <b>Latest Active Subscribers:</b>\n'
      latestSubs.forEach(sub => {
        const name = sub.telegramName || 'Unknown'
        const username = sub.telegramUsername ? ` (@${sub.telegramUsername})` : ''
        const expiry = sub.expiresAt.toLocaleDateString()
        const started = sub.startedAt.toLocaleDateString()
        const plan = sub.planType.toUpperCase()
        subsList += `• ${name}${username} - <b>${plan}</b>\n   └─ Joined: ${started} | Ends: ${expiry}\n`
      })
      if (activeSubscribers > 10) {
        subsList += `<i>... and ${activeSubscribers - 10} more</i>\n`
      }
    }

    // Build the daily report message
    const reportDate = now.toLocaleDateString('en-NG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })

    const message = `📊 <b>Daily Bot Statistics</b>

━━━━━━━━━━━━━━━━━━━

📅 <b>Report Date:</b> ${reportDate}

━━━━━━━━━━━━━━━━━━━

👥 <b>Users Overview:</b>
• Total Bot Users: <b>${totalUsers}</b>
• Unique Subscribers: <b>${uniqueSubscribers.length}</b>
• Non-paying Users: <b>${totalUsers - uniqueSubscribers.length}</b>
• 🆕 <b>New Today:</b> +${newUsersToday}

━━━━━━━━━━━━━━━━━━━

💎 <b>Subscriptions Overview:</b>
• Active VIP Members: <b>${activeSubscribers}</b>
• 🆕 <b>New Today:</b> +${newSubscribersToday}
• Total (All Time): <b>${totalSubscriptions}</b>
• Expired (Inactive): <b>${expiredSubscriptions}</b>
• Active MT5 Copiers: <b>${premiumWithSetup}</b>

━━━━━━━━━━━━━━━━━━━

💰 <b>Financials Overview:</b>
• Total Revenue (All Time): <b>₦${revenueNaira.toLocaleString()}</b>
• 💵 <b>Revenue Today:</b> ₦${revenueNairaToday.toLocaleString()}

━━━━━━━━━━━━━━━━━━━

${statsSection}${subsList}

━━━━━━━━━━━━━━━━━━━

<i>Generated automatically via daily stats cron</i>`

    // Send to admin
    await sendMessage(ADMIN_ID, message)

    console.log(`[Daily Stats] Sent daily report to admin ${ADMIN_ID}`)

    return NextResponse.json({
      success: true,
      stats: {
        totalUsers,
        uniqueSubscribers: uniqueSubscribers.length,
        activeSubscribers,
        newUsersToday,
        newSubscribersToday,
        premiumWithSetup,
        totalRevenue: revenueNaira,
        revenueNairaToday,
        totalSubscriptions,
        expiredSubscriptions,
        latestSubsCount: latestSubs.length
      }
    })
  } catch (error) {
    console.error('[Daily Stats] Error:', error)

    // Send error notification to admin
    await sendMessage(ADMIN_ID, `❌ <b>Daily Stats Failed!</b>

━━━━━━━━━━━━━━━━━━━

Error generating daily statistics report.

━━━━━━━━━━━━━━━━━━━

<b>Error:</b> ${error instanceof Error ? error.message : String(error)}

━━━━━━━━━━━━━━━━━━━

<i>Please check the logs.</i>`)

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET handler - for testing
 */
export async function GET(request: NextRequest) {
  return NextResponse.json({
    status: 'Daily stats endpoint is running',
    usage: 'Send POST request to trigger daily stats'
  })
}
