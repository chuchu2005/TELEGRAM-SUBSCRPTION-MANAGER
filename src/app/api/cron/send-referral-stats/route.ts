import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMessage, formatDate } from '@/lib/telegram'

/**
 * GET handler for daily referral stats cron job
 * Sends referral summary to users who have had activity in the last 30 days
 */
export async function GET(request: NextRequest) {
  try {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    let statsSent = 0

    // Find distinct referrers who have referrals created in the last 30 days
    const recentReferrals = await prisma.referral.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo }
      },
      select: { referrerId: true }
    })

    // Get unique referrer IDs
    const referrerIds = [...new Set(recentReferrals.map(r => r.referrerId))]

    for (const referrerId of referrerIds) {
      try {
        // Get all referrals for this user
        const allRefs = await prisma.referral.findMany({
          where: { referrerId },
          orderBy: { createdAt: 'desc' }
        })

        const pending = allRefs.filter(r => r.rewardStatus === 'pending').length
        const completed = allRefs.filter(r => r.rewardStatus === 'rewarded').length

        // Get milestone progress
        const lastMilestone = await prisma.referralReward.findFirst({
          where: { referrerId },
          orderBy: { createdAt: 'desc' }
        })
        const countedSoFar = lastMilestone?.totalReferrals ?? 0
        const progressTo20 = Math.min(completed - countedSoFar, 20)

        let message = `📊 <b>Daily Referral Update</b>

━━━━━━━━━━━━━━━━━━━

<b>Your Stats:</b>
• Total: ${allRefs.length}
• Pending (not paid yet): ${pending}
• Completed (paid): ${completed}
• Progress to free plan: <b>${progressTo20}/20</b>

━━━━━━━━━━━━━━━━━━━`

        if (pending > 0) {
          message += `\n\n💡 <b>${pending} friend${pending !== 1 ? 's' : ''} joined but haven't paid yet.</b>\nShare a reminder to boost your rewards!`
        }

        if (completed > 0) {
          message += `\n\n✅ <b>You've earned ${completed} free plan${completed !== 1 ? 's' : ''} so far!</b>`
        }

        // Active milestone reward info
        if (lastMilestone?.isActive) {
          const daysLeft = Math.max(0, Math.ceil((lastMilestone.rewardExpiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
          if (daysLeft > 0) {
            message += `\n\n🏆 <b>Active Milestone Reward:</b> Free Basic Plan — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`
          }
        }

        message += `\n\n<i>Keep sharing to earn more free access!</i>\n\nUse /referral to get your link or /myrefs to see details.`

        await sendMessage(Number(referrerId), message)
        statsSent++
      } catch (err) {
        console.error(`[Referral Stats Cron] Error sending to ${referrerId}:`, err)
      }
    }

    return NextResponse.json({
      success: true,
      statsSent,
      totalReferrers: referrerIds.length,
      timestamp: now.toISOString()
    })
  } catch (error) {
    console.error('[Referral Stats Cron] Error:', error)
    return NextResponse.json(
      { error: 'Referral stats cron job failed' },
      { status: 500 }
    )
  }
}

// Allow POST for testing
export async function POST(request: NextRequest) {
  return GET(request)
}
