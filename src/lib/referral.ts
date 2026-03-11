import { prisma } from './prisma'
import { sendMessage, createInviteLink, formatDate, unbanChatMember } from './telegram'

/**
 * Check if referrer has hit 20-click milestone and award free Basic plan
 */
export async function checkAndAwardReferralMilestone(referrerId: string): Promise<void> {
  try {
    // Count ALL joined referrals for this user (clicks / starts that completed join)
    const totalReferrals = await prisma.referral.count({
      where: { referrerId, hasJoined: true }
    })

    // Find the last active ReferralReward to see how many were counted last time
    const lastReward = await prisma.referralReward.findFirst({
      where: { referrerId },
      orderBy: { createdAt: 'desc' }
    })

    const countedSoFar = lastReward?.totalReferrals ?? 0

    // Check how many TOTAL referrals since last milestone
    const referralsSinceLastMilestone = totalReferrals - countedSoFar

    if (referralsSinceLastMilestone < 20) {
      return // Not yet at milestone
    }

    console.log(`[Referral Milestone] User ${referrerId} reached 20 clicks! (total: ${totalReferrals})`)

    // Deactivate any existing active ReferralReward records
    await prisma.referralReward.updateMany({
      where: { referrerId, isActive: true },
      data: { isActive: false }
    })

    // Calculate 7-day free Basic plan expiry
    const freePlanExpiry = new Date()
    freePlanExpiry.setDate(freePlanExpiry.getDate() + 7)

    // Unban + create invite link for referrer
    await unbanChatMember(referrerId)
    const milestoneInviteLink = await createInviteLink()

    // Create free Basic plan subscription
    await prisma.subscription.create({
      data: {
        telegramUserId: referrerId,
        paystackRef: `REF_MILESTONE_${Date.now()}_${referrerId}`,
        amountKobo: 0,
        planType: 'basic',
        hasCopierAccess: false,
        startedAt: new Date(),
        expiresAt: freePlanExpiry,
        inviteLinkUsed: milestoneInviteLink ?? undefined
      }
    })

    // Create new ReferralReward record
    await prisma.referralReward.create({
      data: {
        referrerId,
        totalReferrals,
        rewardPlanType: 'basic',
        rewardExpiry: freePlanExpiry,
        isActive: true
      }
    })

    // Notify referrer with simple, exciting language
    const milestoneLinkLine = milestoneInviteLink
      ? `\n\nHere is your secret VIP invite link:\n👉 ${milestoneInviteLink}`
      : ''

    await sendMessage(Number(referrerId), `🏆 <b>WOW! YOU DID IT!</b> 🏆

━━━━━━━━━━━━━━━━━━━

🎊 <b>20 FRIENDS CLICKED YOUR LINK!</b> 🎊

Because you shared so well, you just won a <b>FREE Basic Plan</b> for a whole week (7 days)! This means you get to see all the VIP trades without paying any money! 🤩

📅 Free VIP ends on: ${formatDate(freePlanExpiry)}${milestoneLinkLine}

━━━━━━━━━━━━━━━━━━━

<b>Want another free week?</b> Just get 20 more friends to click your link! It's that easy!

Tap /myrefs to see how many friends have joined.`)

    console.log(`[Referral Milestone] Free Basic plan granted to ${referrerId} for 20 clicks`)
  } catch (error) {
    console.error(`[Referral Milestone] Error for referrer ${referrerId}:`, error)
  }
}
