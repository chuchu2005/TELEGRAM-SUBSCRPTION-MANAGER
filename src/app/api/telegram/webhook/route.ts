import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMessage, sendPhoto, createInviteLink, formatDate, getDaysRemaining, unbanChatMember, sendMessageWithKeyboard, answerCallbackQuery, editMessageText } from '@/lib/telegram'
import { verifyTransaction, validatePaymentAmount, validatePaymentChannel, formatAmount } from '@/lib/paystack'
import { PLANS, PlanType, BANK_DETAILS, CHANNEL_NAME, RATE_LIMIT, calculateExpiryDate, ADMIN_ID, TRADE_STATS_CONFIG, TRIAL_DISCOUNT } from '@/lib/config'
import { createMt5Account, updateCopierSettings, removeUserMt5Account } from '@/lib/metacopier'
import { encryptPassword, decryptPassword } from '@/lib/encryption'
import { setConversationState, getConversationState, clearConversationState, advanceMt5SetupStep, advancePromoStep, updateConversationData, Mt5SetupStep } from '@/lib/conversation-state'
import { settingsKeyboard, confirmSetupKeyboard, lotSizeKeyboard, maxLotKeyboard, maxLotTotalKeyboard, maxPositionsKeyboard } from '@/lib/telegram-keyboards'
import { generateTradeStatistics, formatStatsMessage } from '@/lib/trade-stats'
import type { TelegramUpdate, TelegramUser } from '@/lib/telegram'

// Telegram file_id for reference.jpg image
const REFERENCE_IMAGE_ID = 'AgACAgQAAxkDAAN-aZS9NIk99_R4Hg0KxzLGvWke2gQAAvoNaxvqeqBQze2qOwiAklEBAAMCAAN5AAM6BA'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!

// In-memory rate limiting store (consider using Redis for production)
const rateLimitStore = new Map<string, { count: number; blockedUntil: number }>()

// Store users waiting for email input
const pendingEmailUsers = new Set<string>()

// Store users waiting for promo email input
const pendingPromoEmailUsers = new Set<string>()

// Store users waiting for copier 24hr promo email input
const pendingCopierPromoEmailUsers = new Set<string>()

// Track if copier promo broadcast is currently running
let isCopierPromoBroadcastRunning = false

// Store users waiting to verify payment (userId -> planType)
const pendingVerificationUsers = new Map<string, PlanType>()

// Idempotency: Track references currently being processed to prevent duplicates
const processingReferences = new Set<string>()

// Track pending settings changes (userId -> pending settings)
const pendingSettingsChanges = new Map<string, {
  lotSize?: number  // User's desired lot size (we calculate multiplier from this)
  maxLotSize?: number
  maximumLot?: number
  maxOpenPositions?: number
  copyStopLoss?: boolean
  copyTakeProfit?: boolean
  tp2Enabled?: boolean
}>()

// Promo expiration settings
const PROMO_EXPIRY_HOURS = 48 // 2 days

/**
 * Check if user is rate limited
 */
function isRateLimited(userId: string): boolean {
  const now = Date.now()
  const userLimit = rateLimitStore.get(userId.toString())

  if (!userLimit) {
    return false
  }

  if (userLimit.blockedUntil > now) {
    return true
  }

  // Reset if block period has passed
  if (userLimit.blockedUntil > 0 && userLimit.blockedUntil <= now) {
    rateLimitStore.delete(userId.toString())
    return false
  }

  return false
}

/**
 * Record failed verification attempt
 * Returns remaining attempts (or 0 if blocked)
 */
function recordFailedAttempt(userId: string): number {
  const now = Date.now()
  const userLimit = rateLimitStore.get(userId.toString()) || { count: 0, blockedUntil: 0 }

  if (userLimit.blockedUntil > now) {
    return 0 // Already blocked
  }

  userLimit.count++

  if (userLimit.count >= RATE_LIMIT.maxAttempts) {
    userLimit.blockedUntil = now + RATE_LIMIT.blockDurationMs
    userLimit.count = 0
    rateLimitStore.set(userId.toString(), userLimit)
    return 0 // Now blocked
  }

  rateLimitStore.set(userId.toString(), userLimit)
  return RATE_LIMIT.maxAttempts - userLimit.count
}

/**
 * Get remaining attempts for a user
 */
function getRemainingAttempts(userId: string): number {
  const userLimit = rateLimitStore.get(userId.toString())
  if (!userLimit) {
    return RATE_LIMIT.maxAttempts
  }
  const now = Date.now()
  if (userLimit.blockedUntil > now) {
    return 0
  }
  return RATE_LIMIT.maxAttempts - userLimit.count
}

/**
 * Reset rate limit for a user (call on successful verification)
 */
function resetRateLimit(userId: string): void {
  rateLimitStore.delete(userId.toString())
}

/**
 * Handle /start command
 */
async function handleStart(user: TelegramUser): Promise<void> {
  // Generate trade statistics if enabled
  let statsSection = ''
  if (TRADE_STATS_CONFIG.enabled) {
    const stats = generateTradeStatistics()
    statsSection = formatStatsMessage(stats)
  }

  const telegramUserId = user.id.toString()

  // Check if user has a recent trial (eligible for 20% discount)
  let trialEligible = false
  if (TRIAL_DISCOUNT.enabled) {
    const now = new Date()
    const twentyFourHoursAgo = new Date(now.getTime() - (TRIAL_DISCOUNT.discountDurationHours * 60 * 60 * 1000))

    const recentTrial = await prisma.subscription.findFirst({
      where: {
        telegramUserId: telegramUserId,
        planType: 'trial',
        expiresAt: { gte: twentyFourHoursAgo }
      },
      orderBy: { expiresAt: 'desc' }
    })

    if (recentTrial && recentTrial.expiresAt >= twentyFourHoursAgo) {
      const hoursSinceTrial = Math.floor((now.getTime() - recentTrial.expiresAt.getTime()) / (60 * 60 * 1000))
      const hoursRemaining = Math.max(0, TRIAL_DISCOUNT.discountDurationHours - hoursSinceTrial)
      if (hoursRemaining > 0) {
        trialEligible = true
      }
    }
  }

  const message = `👋 <b>Welcome to ${CHANNEL_NAME}</b>

${statsSection}

━━━━━━━━━━━━━━━━━━━

📈 <b>VIP Group Trading Performance:</b>

💎 <b>Gold (XAUUSD) Signals:</b>
• 3-4 trades dropped daily
• 96% win rate on XAUUSD
• Premium quality signals
• Entry/Exit points provided

━━━━━━━━━━━━━━━━━━━

🎁 <b>Not Sure Yet? Try FREE for 24 Hours!</b>

• Full access to VIP Gold (XAUUSD) signals
• See 3-4 trades with 96% win rate
• Entry & Exit points included
• No payment required
• Cancel anytime

━━━━━━━━━━━━━━━━━━━

🎁 <b>Tap to Start Your FREE 24-Hour Trial!</b>

━━━━━━━━━━━━━━━━━━━

Choose a plan to get instant access to our VIP community:

💎 <b>Basic Plan</b> - ${trialEligible ? '₦4,000' : '₦5,000'} ${trialEligible ? '<s> (was ₦5,000)</s>' : ''}
├─ <b>7 days</b> access to VIP signals
├─ You copy trades manually
└─ Perfect for trying out

📊 <b>Bi-Weekly Plan</b> - ${trialEligible ? '₦8,000' : '₦10,000'} ${trialEligible ? '<s> (was ₦10,000)</s>' : ''}
├─ <b>14 days</b> access to VIP signals
├─ You copy trades manually
└─ Great balance of price & duration

📅 <b>Monthly Plan</b> - ${trialEligible ? '₦12,000' : '₦15,000'} ${trialEligible ? '<s> (was ₦15,000)</s>' : ''}
├─ <b>30 days</b> access to VIP signals
├─ You copy trades manually
└─ Best value for serious traders

👑 <b>Premium Plan - AUTO COPIER</b> - ${trialEligible ? '₦17,600' : '₦22,000'} ⭐ ${trialEligible ? '<s> (was ₦22,000)</s>' : ''}
├─ <b>14 days</b> access to VIP signals
├─ 🤖 <b>AUTO COPIER BOT</b> - We copy trades FOR YOU!
├─ Trades execute <b>instantly</b> on your MT5
├─ <b>Works 24/7</b> even when your phone is OFF
├─ <b>Zero effort</b> - no manual copying needed
└─ Make money while you sleep! 💰

━━━━━━━━━━━━━━━━━━━

<b>🔥 Why Premium is BEST:</b>

<b>With Manual Plans (Basic/Bi-Weekly/Monthly):</b>
❌ You must watch phone 24/7
❌ You might miss trades while sleeping/busy
❌ Manual copying = slow entries = lost profits
❌ Stressful - always checking Telegram

<b>With Premium Auto Copier:</b>
✅ Trades copied <b>automatically</b> to your MT5
✅ <b>Instant execution</b> = better entry prices
✅ <b>Sleep peacefully</b> - bot works while you rest
✅ <b>Phone data OFF?</b> No problem!
✅ <b>At work?</b> Bot keeps trading!
✅ <b>Zero stress</b> - just check profits at end of day

━━━━━━━━━━━━━━━━━━━

<b>📋 Quick Start:</b>
1️⃣ Send /pay to get payment link
2️⃣ Complete payment securely
3️⃣ Copy your reference & send to bot
4️⃣ Receive invite link instantly!

<b>Need help?</b> Send /help

<b>Any issues?</b> Contact @pearsignals

━━━━━━━━━━━━━━━━━━━

<i>Type /pay to get started</i>`

  await sendMessageWithKeyboard(user.id, message, {
    inline_keyboard: [
      [
        { text: '🎁 Start Your FREE 24-Hour Trial! 🎁', callback_data: 'start_trial' }
      ]
    ]
  })
}

/**
 * Handle /trial command
 */
async function handleTrial(user: TelegramUser): Promise<void> {
  // Check if user has ANY previous subscription history (trials or paid plans)
  const previousSubs = await prisma.subscription.count({
    where: {
      telegramUserId: user.id.toString()
    }
  })

  // Block existing or previous customers from taking a free trial
  if (previousSubs > 0) {
    const message = `❌ <b>You're Already a VIP!</b>

Free trials are only available for new users.

To get VIP signals, upgrade to a paid plan:

💎 Basic: ₦5,000 (7 days)
📊 Bi-Weekly: ₦10,000 (14 days)
📅 Monthly: ₦15,000 (30 days)
👑 Premium: ₦22,000 (14 days + Copier)

Tap below to get started!`

    await sendMessageWithKeyboard(user.id, message, {
      inline_keyboard: [[
        { text: '💳 Upgrade to Paid Plan', callback_data: 'pay' }
      ]]
    })
    return
  }

  // Create trial subscription
  const expiresAt = new Date()
  expiresAt.setHours(expiresAt.getHours() + 24) // 24 hours from now

  // Always unban user before creating invite link (safety measure)
  await unbanChatMember(user.id)
  console.log(`Unbanned user ${user.id} before sending trial invite link`)

  const inviteLink = await createInviteLink()

  if (!inviteLink) {
    await sendMessage(user.id, `Sorry, couldn't create invite link. Try again.`)
    return
  }

  await prisma.subscription.create({
    data: {
      telegramUserId: user.id.toString(),
      telegramUsername: user.username,
      telegramName: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'User',
      paystackRef: `TRIAL_${Date.now()}_${user.id}`, // Unique reference
      amountKobo: 0,
      planType: 'trial',
      hasCopierAccess: false,
      startedAt: new Date(),
      expiresAt,
      inviteLinkUsed: inviteLink
    }
  })

  // Send trial welcome message with conversion hooks
  const message = `🎁 <b>Your FREE 24-Hour Trial Has Started!</b>

━━━━━━━━━━━━━━━━━━━

✅ <b>What You Get:</b>
• Access to VIP Gold (XAUUSD) signals
• 3-4 high-quality signals daily
• 96% win rate on Gold
• Entry & Exit points
• Real-time trade notifications

━━━━━━━━━━━━━━━━━━━

⏰ <b>Trial Expires:</b> ${formatDate(expiresAt)}

⏱ <b>Time Remaining:</b> 24 hours

━━━━━━━━━━━━━━━━━━━

Your one-time invite link (valid for 24 hours):
👉 ${inviteLink}

━━━━━━━━━━━━━━━━━━━

💡 <b>Pro Tip:</b>
Watch our signals for 24 hours and see the quality!
When you see results, upgrade to keep access permanently.

<b>Want to upgrade now?</b> Type /pay anytime!`

  await sendMessageWithKeyboard(user.id, message, {
    inline_keyboard: [[
      { text: '💳 Upgrade to Paid Plan', callback_data: 'pay' }
    ]]
  })
}

/**
 * Handle /help command
 */
async function handleHelp(user: TelegramUser): Promise<void> {
  const message = `📖 <b>How to Get Started</b>

━━━━━━━━━━━━━━━━━━━

<b>Step 1: Get Payment Link</b>
Send the command: /pay

<b>Step 2: Choose Your Plan</b>
💎 Basic (₦5,000) - 7 days, manual copying
📊 Bi-Weekly (₦10,000) - 14 days, manual copying
📅 Monthly (₦15,000) - 30 days, manual copying
👑 <b>Premium (₦22,000)</b> - 14 days + <b>AUTO COPIER BOT</b> ⭐

━━━━━━━━━━━━━━━━━━━

<b>🔥 Why Choose Premium?</b>

<i>"I was missing trades while sleeping. With Premium Auto Copier, I woke up to ₦45,000 profit!"</i>

<b>Premium Benefits:</b>
✅ Trades copied <b>automatically</b> to your MT5
✅ <b>Works 24/7</b> - even when phone is OFF
✅ <b>Instant execution</b> = better prices
✅ <b>Zero effort</b> - make money while you sleep
✅ Perfect for busy people & 9-5 workers

━━━━━━━━━━━━━━━━━━━

<b>Step 3: Make Payment</b>
• Pay securely with bank transfer
• Payment is instant & automatic

<b>Step 4: Get Your Reference</b>
• After payment, you'll see a receipt
• Copy the reference (e.g., TXN_1234567890)

<b>Step 5: Verify & Get Access</b>
• Send: /verify_basic YOUR_REFERENCE
• Or: /verify_biweekly YOUR_REFERENCE
• Or: /verify_monthly YOUR_REFERENCE
• Or: /verify_premium YOUR_REFERENCE
• Bot verifies instantly → sends invite link

━━━━━━━━━━━━━━━━━━━

<b>❓ Frequently Asked Questions</b>

<i>Q: What is the Auto Copier Bot?</i>
A: It automatically copies every trade from our VIP channel to your MT5 account instantly. No manual work needed!

<i>Q: Does it work when my phone is off?</i>
A: YES! The bot runs on our server 24/7, so trades copy to your MT5 even if your phone is off or no data.

<i>Q: What if I don't have a reference?</i>
A: Make sure you copy it from the Paystack success page after payment.

<i>Q: How long does the invite link last?</i>
A: 24 hours from when it was created.

<i>Q: Can I renew after it expires?</i>
A: Yes! Just pay again and verify the new reference.

<i>Q: I'm stuck. What do I do?</i>
A: Send /pay to start over, or /status to check your current subscription.

━━━━━━━━━━━━━━━━━━━

<i>Ready to start making passive income? Send /pay to begin!</i>`

  await sendMessage(user.id, message)
}

/**
 * Handle /pay command - Collect email, then show payment options
 */
async function handlePay(user: TelegramUser): Promise<void> {
  const telegramUserId = user.id.toString()

  // Mark user as waiting for email
  pendingEmailUsers.add(telegramUserId)

  await sendMessage(user.id, `📧 <b>Step 1: Enter Your Email</b>

Please provide your email address to continue.

<b>Why do we need this?</b>
✅ To send your official payment receipt
✅ To help if there are any issues
✅ To notify you before expiration

━━━━━━━━━━━━━━━━━━━

<i>Just type your email (e.g., john@email.com)</i>

<i>Or send /cancel to exit</i>`)
}

/**
 * Show payment buttons after collecting email
 */
async function showPaymentButtons(user: TelegramUser, email: string): Promise<void> {
  const telegramUserId = user.id.toString()
  const telegramUsername = user.username || 'unknown'

  // Remove from pending list
  pendingEmailUsers.delete(telegramUserId)

  // Check if user has a recent trial (eligible for 20% discount)
  let hasRecentTrial = false
  let trialEligible = false
  if (TRIAL_DISCOUNT.enabled) {
    const now = new Date()
    const twentyFourHoursAgo = new Date(now.getTime() - (TRIAL_DISCOUNT.discountDurationHours * 60 * 60 * 1000))

    const recentTrial = await prisma.subscription.findFirst({
      where: {
        telegramUserId: telegramUserId,
        planType: 'trial',
        expiresAt: { gte: twentyFourHoursAgo }
      },
      orderBy: { expiresAt: 'desc' }
    })

    if (recentTrial && recentTrial.expiresAt >= twentyFourHoursAgo) {
      // Trial ended within the discount window
      const hoursSinceTrial = Math.floor((now.getTime() - recentTrial.expiresAt.getTime()) / (60 * 60 * 1000))
      const hoursRemaining = Math.max(0, TRIAL_DISCOUNT.discountDurationHours - hoursSinceTrial)

      if (hoursRemaining > 0) {
        hasRecentTrial = true
        trialEligible = true
      }
    }
  }

  // Remove from pending list
  pendingEmailUsers.delete(telegramUserId)

  try {
    console.log('Creating payment links for user:', telegramUserId, 'email:', email)

    // Create payment link for Basic plan
    const basicResponse = await fetch(`${APP_URL}/api/payment/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: telegramUserId,
        telegramUsername,
        planType: 'basic',
        email // Pass user's email
      })
    })

    const basicData = await basicResponse.json()
    console.log('Basic payment link response:', basicData)

    // Create payment link for Bi-Weekly plan
    const biweeklyResponse = await fetch(`${APP_URL}/api/payment/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: telegramUserId,
        telegramUsername,
        planType: 'biweekly',
        email // Pass user's email
      })
    })

    const biweeklyData = await biweeklyResponse.json()
    console.log('Bi-Weekly payment link response:', biweeklyData)

    // Create payment link for Monthly plan
    const monthlyResponse = await fetch(`${APP_URL}/api/payment/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: telegramUserId,
        telegramUsername,
        planType: 'monthly',
        email // Pass user's email
      })
    })

    const monthlyData = await monthlyResponse.json()
    console.log('Monthly payment link response:', monthlyData)

    // Create payment link for Premium plan
    const premiumResponse = await fetch(`${APP_URL}/api/payment/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: telegramUserId,
        telegramUsername,
        planType: 'premium',
        email // Pass user's email
      })
    })

    const premiumData = await premiumResponse.json()
    console.log('Premium payment link response:', premiumData)

    if (!basicData.success || !biweeklyData.success || !monthlyData.success || !premiumData.success) {
      console.error('Payment link generation failed:', { basicData, biweeklyData, monthlyData, premiumData })
      await sendMessage(user.id, '❌ Failed to generate payment links. Please try again later.\n\nSend /pay to start over.')
      return
    }

    const message = `✅ <b>Email Confirmed:</b> ${email}

━━━━━━━━━━━━━━━━━━━

💳 <b>Step 2: Choose Your Plan</b>

${trialEligible ? `
━━━━━━━━━━━━━━━━━━━

${TRIAL_DISCOUNT.discountMessage}

━━━━━━━━━━━━━━━━━━━

💎 Special Prices (20% OFF):

` : ''}

💎 <b>Basic Plan</b> - ${trialEligible ? '₦4,000' : '₦5,000'}
├─ <b>7 days</b> access to VIP signals
├─ You copy trades manually
└─ For trying out

📊 <b>Bi-Weekly Plan</b> - ${trialEligible ? '₦8,000' : '₦10,000'} ${trialEligible ? '<s> (was ₦10,000)</s>' : ''}
├─ <b>14 days</b> access to VIP signals
├─ You copy trades manually
└─ Great balance of price & duration

📅 <b>Monthly Plan</b> - ${trialEligible ? '₦12,000' : '₦15,000'} ${trialEligible ? '<s> (was ₦15,000)</s>' : ''}
├─ <b>30 days</b> access to VIP signals
├─ You copy trades manually
└─ Best for consistent trading

👑 <b>Premium - AUTO COPIER</b> - ${trialEligible ? '₦17,600' : '₦22,000'} ⭐ ${trialEligible ? '<s> (was ₦22,000)</s>' : ''}
├─ <b>14 days</b> VIP signals + <b>AUTO COPIER BOT</b>
├─ 🤖 Trades copy <b>automatically</b> to your MT5
├─ 💰 Make money while you sleep
├─ 📴 Works even when phone is OFF
├─ ⚡ <b>Instant execution</b> - never miss a trade
└─ 🚀 <b>Zero effort</b> - fully automated!

━━━━━━━━━━━━━━━━━━━

<b>🔥 Premium = Passive Income!</b>

Stop missing trades while you sleep/busy.
Let our bot copy trades FOR you 24/7!

${trialEligible ? `
━━━━━━━━━━━━━━━━━━━

⏰ <b>LIMITED TIME OFFER!</b>

This 20% discount is only valid for ${TRIAL_DISCOUNT.discountDurationHours} hours after your trial ended.

━━━━━━━━━━━━━━━━━━━` : ''}

━━━━━━━━━━━━━━━━━━━

<b>Tap a button below to pay securely:</b>

Payment via bank transfer only

After payment → You'll see your reference
Then send: /verify_basic REFERENCE

💡 Tip: You'll find the reference on the success page after payment

Or send /pay to start over

💎 Pay ${trialEligible ? '₦4,000' : '₦5,000'} (Basic - 7 days) ${trialEligible ? '🔥 20% OFF!' : ''}
📊 Pay ${trialEligible ? '₦8,000' : '₦10,000'} (Bi-Weekly - 14 days) ${trialEligible ? '🔥 20% OFF!' : ''}
📅 Pay ${trialEligible ? '₦12,000' : '₦15,000'} (Monthly - 30 days) ${trialEligible ? '🔥 20% OFF!' : ''}
👑 Pay ${trialEligible ? '₦17,600' : '₦22,000'} (Premium - 14 days + Auto Copier) ⭐ ${trialEligible ? '🔥 20% OFF!' : ''}

Still have questions? Send /help`

    // Send message with inline keyboard
    console.log('Sending message with payment buttons to Telegram...')
    const telegramResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: user.id,
        text: message,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: `💎 Pay ${trialEligible ? '₦4,000 (was ₦5,000)' : '₦5,000'} - Basic`, url: basicData.authorizationUrl }
            ],
            [
              { text: '✅ Verify Basic Payment', callback_data: 'verify_basic' }
            ],
            [
              { text: `📊 Pay ${trialEligible ? '₦8,000 (was ₦10,000)' : '₦10,000'} - Bi-Weekly`, url: biweeklyData.authorizationUrl }
            ],
            [
              { text: '✅ Verify Bi-Weekly Payment', callback_data: 'verify_biweekly' }
            ],
            [
              { text: `📅 Pay ${trialEligible ? '₦12,000 (was ₦15,000)' : '₦15,000'} - Monthly`, url: monthlyData.authorizationUrl }
            ],
            [
              { text: '✅ Verify Monthly Payment', callback_data: 'verify_monthly' }
            ],
            [
              { text: `👑 Pay ${trialEligible ? '₦17,600 (was ₦22,000)' : '₦22,000'} - Premium ⭐`, url: premiumData.authorizationUrl }
            ],
            [
              { text: '✅ Verify Premium Payment', callback_data: 'verify_premium' }
            ]
          ]
        }
      })
    })

    const telegramData = await telegramResponse.json()
    console.log('Telegram API response:', telegramData)

    if (!telegramData.ok) {
      console.error('Telegram API error:', telegramData)
      await sendMessage(user.id, '❌ Error sending payment buttons. Please try /pay again.')
      return
    }

    console.log('Payment buttons sent successfully!')
  } catch (error) {
    console.error('Error showing payment buttons:', error)
    await sendMessage(user.id, '❌ Error generating payment links. Please try again later.\n\nSend /pay to start over.')
  }
}

/**
 * Handle promo pay command - Collect email, then show promo payment options
 */
async function handlePromoPay(user: TelegramUser): Promise<void> {
  const telegramUserId = user.id.toString()
  pendingPromoEmailUsers.add(telegramUserId)
  await sendMessage(user.id, `📧 <b>Step 1: Enter Your Email</b>\n\nPlease provide your email address to continue with your promo.\n\n<b>Why do we need this?</b>\n✅ To send your official payment receipt\n✅ To help if there are any issues\n✅ To notify you before expiration\n\n━━━━━━━━━━━━━━━━━━━\n\n<i>Just type your email (e.g., john@email.com)</i>\n\n<i>Or send /cancel to exit</i>`)
}

/**
 * Show promo payment button after collecting email
 */
async function showPromoPaymentButton(user: TelegramUser, email: string): Promise<void> {
  const telegramUserId = user.id.toString()
  const telegramUsername = user.username || 'unknown'

  pendingPromoEmailUsers.delete(telegramUserId)

  try {
    const promoResponse = await fetch(`${APP_URL}/api/payment/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: telegramUserId,
        telegramUsername,
        planType: 'promo',
        email
      })
    })

    const promoData = await promoResponse.json()

    if (!promoData.success) {
      await sendMessage(user.id, '❌ Failed to generate promo payment link. Please try again later.')
      return
    }

    const message = `✅ <b>Email Confirmed:</b> ${email}\n\n━━━━━━━━━━━━━━━━━━━\n\n🔥 <b>SPECIAL PROMO OFFER - ₦3,000 (7 Days)</b>\n\nTap below to pay securely:`

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: user.id,
        text: message,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔥 Pay ₦3,000 Now', url: promoData.authorizationUrl }
            ],
            [
              { text: '✅ Verify Promo Payment', callback_data: 'verify_promo' }
            ]
          ]
        }
      })
    })

  } catch (error) {
    console.error('Error showing promo payment button:', error)
    await sendMessage(user.id, '❌ Error generating payment links. Please try again later.')
  }
}

/**
 * Handle copier 24hr promo pay command - Collect email, then show payment options
 */
async function handleCopierPromoPay(user: TelegramUser): Promise<void> {
  const telegramUserId = user.id.toString()
  pendingCopierPromoEmailUsers.add(telegramUserId)
  await sendMessage(user.id, `📧 <b>Step 1: Enter Your Email</b>

Please provide your email address to continue with your Auto Copier promo.

<b>Why do we need this?</b>
✅ To send your official payment receipt
✅ To help if there are any issues
✅ To notify you before expiration

━━━━━━━━━━━━━━━━━━━

<i>Just type your email (e.g., john@email.com)</i>

<i>Or send /cancel to exit</i>`)
}

/**
 * Show copier 24hr promo payment button after collecting email
 */
async function showCopierPromoPaymentButton(user: TelegramUser, email: string): Promise<void> {
  const telegramUserId = user.id.toString()
  const telegramUsername = user.username || 'unknown'

  pendingCopierPromoEmailUsers.delete(telegramUserId)

  try {
    const promoResponse = await fetch(`${APP_URL}/api/payment/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: telegramUserId,
        telegramUsername,
        planType: 'copier24hr',
        email
      })
    })

    const promoData = await promoResponse.json()

    if (!promoData.success) {
      await sendMessage(user.id, '❌ Failed to generate promo payment link. Please try again later.')
      return
    }

    const message = `✅ <b>Email Confirmed:</b> ${email}

━━━━━━━━━━━━━━━━━━━

🔥 <b>LIMITED TIME OFFER - 24 HOURS ONLY!</b>

🎯 <b>Get the Auto Copier Bot for ₦15,000!</b>

Regular Price: <s>₦22,000</s>
<b>YOUR PRICE: ₦15,000</b>

━━━━━━━━━━━━━━━━━━━

<b>🚀 What You Get with Auto Copier:</b>

✅ Trades copied <b>automatically</b> to your MT5
✅ <b>Works 24/7</b> - even when your phone is OFF
✅ <b>Instant execution</b> = better entry prices
✅ <b>Full 14 days</b> of automated trading

⏰ <b>Offer expires in 24 hours!</b>

━━━━━━━━━━━━━━━━━━━

Tap below to pay securely:`

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: user.id,
        text: message,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔥 Pay ₦15,000 Now (Auto Copier)', url: promoData.authorizationUrl }
            ],
            [
              { text: '✅ Verify Copier Promo Payment', callback_data: 'verify_copier24hr' }
            ]
          ]
        }
      })
    })

  } catch (error) {
    console.error('Error showing copier promo payment button:', error)
    await sendMessage(user.id, '❌ Error generating payment links. Please try again later.')
  }
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Handle /broadcast command - Admin only
 * Sends message to ALL users
 * Usage: /broadcast Your message here
 */
async function handleBroadcast(user: TelegramUser, args: string[]): Promise<void> {
  await sendBroadcast(user, args, 'all', false)
}

/**
 * Handle /broadcast_active command - Admin only
 * Sends message to active subscribers only
 * Usage: /broadcast_active Your message here
 */
async function handleBroadcastActive(user: TelegramUser, args: string[]): Promise<void> {
  await sendBroadcast(user, args, 'all', true)
}

/**
 * Handle /broadcast_premium command - Admin only
 * Sends message to premium users only
 * Usage: /broadcast_premium Your message here
 */
async function handleBroadcastPremium(user: TelegramUser, args: string[]): Promise<void> {
  await sendBroadcast(user, args, 'premium', false)
}

/**
 * Handle /broadcast_copier_promo command - Admin only
 * Sends copier promo with payment button to ALL users
 * Usage: /broadcast_copier_promo
 */
async function handleCopierPromoBroadcast(user: TelegramUser): Promise<void> {
  // Check if user is admin
  if (user.id !== ADMIN_ID) {
    await sendMessage(user.id, '❌ Only admin can use this command.')
    return
  }

  // Prevent duplicate broadcasts
  if (isCopierPromoBroadcastRunning) {
    await sendMessage(user.id, '⚠️ Broadcast already running. Please wait for it to complete.')
    return
  }

  isCopierPromoBroadcastRunning = true

  const message = `🔥 <b>LIMITED TIME OFFER - 24 HOURS ONLY!</b>

━━━━━━━━━━━━━━━━━━━

🎯 <b>Get the Auto Copier Bot for ₦15,000!</b>

Regular Price: <s>₦22,000</s>
<b>YOUR PRICE: ₦15,000</b>

━━━━━━━━━━━━━━━━━━━

<b>🚀 How It Works:</b>

✅ <b>Automated bot that trades for you</b> - No manual work needed!
✅ <b>It analyzes trades and places them for you</b> as well
✅ <b>Same trades</b> from the VIP signals channel
✅ <b>96% win rate</b> on all trades
✅ <b>Works 24/7</b> - even when your phone is OFF
✅ <b>Full 14 days</b> of automated trading

━━━━━━━━━━━━━━━━━━━

⚠️ <b>Offer expires in 24 hours!</b> After that, price returns to ₦22,000.

👇 Tap the button below to get your payment link now!`

  const replyMarkup = {
    inline_keyboard: [[
      { text: '🔥 GET ₦15,000 PROMO (Auto Copier)', callback_data: 'promo_copier_24hr' }
    ]]
  }

  await sendMessage(user.id, `📢 <b>Broadcasting copier promo...</b>

━━━━━━━━━━━━━━━━━━━

${message}

━━━━━━━━━━━━━━━━━━━

<i>Sending to all users...</i>
<i>I'll send you a summary when done!</i>`)

  // Get ALL users (send to everyone, including previous buyers)
  const allUsers = await prisma.user.findMany({
    select: { telegramUserId: true }
  })
  console.log(`[Copier Promo Broadcast] Targeting ALL users from User table: ${allUsers.length} recipients`)

  let successCount = 0
  let failedCount = 0
  const failedUsers: string[] = []

  for (const recipient of allUsers) {
    try {
      const sent = await sendMessageWithKeyboard(recipient.telegramUserId, message, replyMarkup)
      if (sent) {
        successCount++
      } else {
        failedCount++
        failedUsers.push(recipient.telegramUserId.toString())
      }
    } catch (error) {
      failedCount++
      console.error(`Failed to send to ${recipient.telegramUserId}:`, error)
    }

    await new Promise(resolve => setTimeout(resolve, 100))
  }

  await sendMessage(user.id, `✅ <b>Copier Promo Broadcast Complete!</b>

━━━━━━━━━━━━━━━━━━━

📊 <b>Stats:</b>
• ✅ Sent successfully: ${successCount}
• ❌ Failed: ${failedCount}

━━━━━━━━━━━━━━━━━━━`)
}

/**
 * Handle /test_copier_promo command - Admin only
 * Sends copier promo to admin only (for testing)
 * Usage: /test_copier_promo
 */
async function handleTestCopierPromoBroadcast(user: TelegramUser): Promise<void> {
  // Check if user is admin
  if (user.id !== ADMIN_ID) {
    await sendMessage(user.id, '❌ Only admin can use this command.')
    return
  }

  const message = `🔥 <b>LIMITED TIME OFFER - 24 HOURS ONLY!</b>

━━━━━━━━━━━━━━━━━━━

🎯 <b>Get the Auto Copier Bot for ₦15,000!</b>

Regular Price: <s>₦22,000</s>
<b>YOUR PRICE: ₦15,000</b>

━━━━━━━━━━━━━━━━━━━

<b>🚀 How It Works:</b>

✅ <b>Automated bot that trades for you</b> - No manual work needed!
✅ <b>It analyzes trades and places them for you</b> as well
✅ <b>Same trades</b> from VIP signals channel
✅ <b>96% win rate</b> on all trades
✅ <b>Works 24/7</b> - even when your phone is OFF
✅ <b>Full 14 days</b> of automated trading

━━━━━━━━━━━━━━━━━━━

⚠️ <b>Offer expires in 24 hours!</b> After that, price returns to ₦22,000.

👇 Tap the button below to get your payment link now!`

  const replyMarkup = {
    inline_keyboard: [[
      { text: '🔥 GET ₦15,000 PROMO (Auto Copier)', callback_data: 'promo_copier_24hr' }
    ]]
  }

  await sendMessageWithKeyboard(user.id, message, replyMarkup)
}

/**
 * Handle /broadcast_promo command - Admin only
 * Sends promo offer with payment button to ALL users
 * Usage: /broadcast_promo
 * Note: Each broadcast creates FRESH payment links that expire after 2 days.
 */
async function handleBroadcastPromo(user: TelegramUser): Promise<void> {
  // Check if user is admin
  if (user.id !== ADMIN_ID) {
    await sendMessage(user.id, '❌ Only the admin can use this command.')
    return
  }

  const broadcastTimestamp = Date.now()

  // Get ALL users (send to everyone, including previous buyers)
  const allUsers = await prisma.subscription.findMany({
    select: {
      telegramUserId: true,
      telegramUsername: true
    },
    distinct: ['telegramUserId']
  })

  const expiryDate = new Date(broadcastTimestamp + (PROMO_EXPIRY_HOURS * 60 * 60 * 1000))
  const expiryHours = Math.floor(PROMO_EXPIRY_HOURS)

  await sendMessage(user.id, `📢 <b>Sending Promo Broadcast...</b>

━━━━━━━━━━━━━━━━━━━

🔥 <b>Special Promo Offer - ₦3,000 (7 days)</b>

━━━━━━━━━━━━━━━━━━━

Sending to ${allUsers.length} users...

Links expire in ${expiryHours} hours (${expiryDate.toLocaleDateString()})

I'll send you a summary when done!`)

  let successCount = 0
  let failedCount = 0

  const promoMessage = `🔥 <b>SPECIAL PROMO OFFER!</b>

━━━━━━━━━━━━━━━━━━━

💎 <b>LIMITED TIME: 7 Days for ONLY ₦3,000!</b>

━━━━━━━━━━━━━━━━━━━

That's <b>₦2,000 OFF</b> the regular Basic plan!

Perfect for:
• Trying out our VIP signals
• Seeing the quality of our trades
• Getting started with low risk

━━━━━━━━━━━━━━━━━━━

<b>⚠️ IMPORTANT:</b>
• Each payment link expires in ${expiryHours} hours
• After expiry, wait for the next promo broadcast
• Links work ONCE only

━━━━━━━━━━━━━━━━━━━

<i>Don't miss this chance! Click below to get instant access!</i>`

  for (const targetUser of allUsers) {
    try {
      // Send message with payment button
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetUser.telegramUserId,
          text: promoMessage,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔥 Get ₦3,000 Promo (7 Days)', callback_data: 'pay_promo' }
              ]
            ]
          }
        })
      })
      successCount++
    } catch (error) {
      failedCount++
    }

    await new Promise(resolve => setTimeout(resolve, 100))
  }

  await sendMessage(user.id, `✅ <b>Promo Broadcast Complete!</b>

━━━━━━━━━━━━━━━━━━━

📊 <b>Stats:</b>
• ✅ Sent successfully: ${successCount}
• ❌ Failed: ${failedCount}

━━━━━━━━━━━━━━━━━━━

<b>Important:</b>
• Links expire in ${expiryHours} hours
• Each link works ONCE only
• After expiry, send new broadcast for fresh links`)
}

/**
 * Shared broadcast function
 */
async function sendBroadcast(user: TelegramUser, args: string[], planType: 'basic' | 'biweekly' | 'monthly' | 'premium' | 'all', activeOnly: boolean): Promise<void> {
  // Check if user is admin
  if (user.id !== ADMIN_ID) {
    await sendMessage(user.id, '❌ Only the admin can use this command.')
    return
  }

  // Get message from args
  const message = args.join(' ')

  if (!message.trim()) {
    await sendMessage(user.id, `❌ Please provide a message to broadcast.

<b>Usage:</b>
/broadcast Your message here
/broadcast Message | Button Text | callback_data

<b>Examples:</b>
/broadcast 🎉 Special offer this week!
/broadcast 🔥 PROMO: ₦3,000 for 7 days! | 🔥 Get Promo | pay_promo

<b>Available commands:</b>
/broadcast - Send to everyone
/broadcast_active - Send to active subscribers only
/broadcast_premium - Send to premium users only`)
    return
  }

  // Send acknowledgment
  const targetType = planType === 'all' ? 'all users' : `${planType} users`
  const filterType = activeOnly ? 'active subscribers only' : targetType

  await sendMessage(user.id, `📢 <b>Broadcasting message...</b>

━━━━━━━━━━━━━━━━━━━

${message}

━━━━━━━━━━━━━━━━━━━

<i>Sending to ${filterType}...</i>

<i>I'll send you a summary when done!</i>`)

  // Build query for recipients
  let whereClause: any = {}

  if (planType !== 'all') {
    whereClause.planType = planType
  }

  if (activeOnly) {
    whereClause.expiresAt = { gt: new Date() }
    whereClause.isRemoved = false
  }

  // Get all unique telegram user IDs
  let recipients: { telegramUserId: string }[] = []

  if (planType === 'all' && !activeOnly) {
    // Default for /broadcast: Send to EVERYONE in the User table
    recipients = await prisma.user.findMany({
      select: { telegramUserId: true }
    })
    console.log(`[Broadcast] Targeting ALL users from User table: ${recipients.length} recipients`)
  } else {
    // Filtered broadcast: Get unique telegram user IDs from subscriptions
    const subs = await prisma.subscription.findMany({
      where: whereClause,
      select: {
        telegramUserId: true,
      },
      distinct: ['telegramUserId']
    })
    recipients = subs
    console.log(`[Broadcast] Targeting filtered users from Subscription table: ${recipients.length} recipients`)
  }

  // Send message to each user
  let successCount = 0
  let failedCount = 0
  const failedUsers: string[] = []

  // Support for optional button in broadcast: "Your message | Button Text | callback_data"
  // Example: "/broadcast 🎉 BIG PROMO! | 🔥 Pay ₦3,000 | pay_promo"
  const messageParts = message.split('|').map(p => p.trim())
  const cleanMessage = messageParts[0]
  const buttonText = messageParts[1]
  const callbackData = messageParts[2]

  for (const recipient of recipients) {
    try {
      let sent = false
      if (buttonText && callbackData) {
        sent = await sendMessageWithKeyboard(recipient.telegramUserId, cleanMessage, {
          inline_keyboard: [[{ text: buttonText, callback_data: callbackData }]]
        })
      } else {
        sent = await sendMessage(recipient.telegramUserId, cleanMessage)
      }

      if (sent) {
        successCount++
      } else {
        failedCount++
      }
    } catch (error) {
      failedCount++
    }

    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  // Send summary to admin
  const summary = `✅ <b>Broadcast Complete!</b>

━━━━━━━━━━━━━━━━━━━

📊 <b>Stats:</b>
• Total recipients: ${recipients.length}
• ✅ Successful: ${successCount}
• ❌ Failed: ${failedCount}

${failedUsers.length > 0 ? `❌ <b>Failed Users:</b>\n${failedUsers.slice(0, 10).join('\n')}${failedUsers.length > 10 ? `\n... and ${failedUsers.length - 10} more` : ''}` : ''}`

  await sendMessage(user.id, summary)

  // Reset broadcast running flag
  isCopierPromoBroadcastRunning = false
}

/**
 * Handle /botstats command - Admin only
 * Shows comprehensive usage statistics
 */
async function handleBotStats(user: TelegramUser): Promise<void> {
  // Check if user is admin
  if (user.id !== ADMIN_ID) {
    await sendMessage(user.id, '❌ Only the admin can use this command.')
    return
  }

  try {
    // 1. Total unique bot users (captured from /start and messages)
    const totalUsers = await prisma.user.count()

    // 2. Total unique subscribers (people who paid or used promo)
    const uniqueSubscribers = await prisma.subscription.groupBy({
      by: ['telegramUserId'],
    })

    // 3. Active subscribers
    const now = new Date()
    const activeSubscribers = await prisma.subscription.count({
      where: {
        expiresAt: { gt: now },
        isRemoved: false
      }
    })

    // 4. Premium users with MT5 Setup
    const premiumWithSetup = await prisma.mt5Setup.count()

    // 5. Total Revenue (NGN)
    const totalRevenue = await prisma.subscription.aggregate({
      _sum: {
        amountKobo: true
      }
    })

    const revenueNaira = (totalRevenue._sum.amountKobo || 0) / 100

    // 6. Get latest active subscribers (limit to 10 for readability)
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
        planType: true
      }
    })

    let subsList = ''
    if (latestSubs.length > 0) {
      subsList = '\n\n📅 <b>Latest Active Subscribers:</b>\n'
      latestSubs.forEach(sub => {
        const name = sub.telegramName || 'Unknown'
        const username = sub.telegramUsername ? ` (@${sub.telegramUsername})` : ''
        const expiry = sub.expiresAt.toLocaleDateString()
        const plan = sub.planType.toUpperCase()
        subsList += `• ${name}${username} - <b>${plan}</b> (Ends: ${expiry})\n`
      })
      if (activeSubscribers > 10) {
        subsList += `<i>... and ${activeSubscribers - 10} more</i>\n`
      }
    }

    const message = `📊 <b>Bot Usage Statistics (Admin)</b>

━━━━━━━━━━━━━━━━━━━

👥 <b>Users:</b>
• Total Bot Users: <b>${totalUsers}</b>
• Unique Subscribers: <b>${uniqueSubscribers.length}</b>
• Non-paying Users: <b>${totalUsers - uniqueSubscribers.length}</b>

💎 <b>Subscriptions:</b>
• Active VIP Members: <b>${activeSubscribers}</b>
• Active MT5 Copiers: <b>${premiumWithSetup}</b>

💰 <b>Financials:</b>
• Total Revenue: <b>₦${revenueNaira.toLocaleString()}</b>${subsList}

━━━━━━━━━━━━━━━━━━━

<i>Note: "Total Bot Users" includes everyone who ever clicked /start or messaged the bot since tracking was enabled.</i>`

    await sendMessage(user.id, message)
  } catch (error) {
    console.error('Error fetching bot stats:', error)
    await sendMessage(user.id, '❌ Failed to fetch bot statistics.')
  }
}

/**
 * Handle /checkuser <id|username> command - Admin only
 * Look up a specific user's status
 */
async function handleCheckUser(admin: TelegramUser, args: string[]): Promise<void> {
  // Check if user is admin
  if (admin.id !== ADMIN_ID) {
    await sendMessage(admin.id, '❌ Only the admin can use this command.')
    return
  }

  const query = args[0]?.trim()
  if (!query) {
    await sendMessage(admin.id, `❌ Please provide a User ID or Username.
    
<b>Usage:</b>
/checkuser 123456789
/checkuser @username`)
    return
  }

  // Clean username if provided
  const cleanQuery = query.startsWith('@') ? query.substring(1) : query

  try {
    // Search for user in User table or Subscription table
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { telegramUserId: cleanQuery },
          { telegramUsername: { equals: cleanQuery, mode: 'insensitive' } }
        ]
      }
    })

    const userId = user?.telegramUserId || cleanQuery

    // Find all subscriptions for this user
    const subscriptions = await prisma.subscription.findMany({
      where: { telegramUserId: userId },
      orderBy: { startedAt: 'desc' },
      include: { mt5Setup: true }
    })

    if (subscriptions.length === 0 && !user) {
      await sendMessage(admin.id, `❌ No user found with ID/Username: <b>${query}</b>`)
      return
    }

    const latestSub = subscriptions[0]
    const now = new Date()
    const isActive = latestSub && latestSub.expiresAt > now && !latestSub.isRemoved

    let response = `👤 <b>User Lookup: ${query}</b>

━━━━━━━━━━━━━━━━━━━

🆔 <b>ID:</b> <code>${userId}</code>
👤 <b>Name:</b> ${user?.telegramName || (latestSub?.telegramName) || 'Unknown'}
📧 <b>Email:</b> ${latestSub?.customerEmail || 'None'}

━━━━━━━━━━━━━━━━━━━

📊 <b>Subscription:</b>
• Status: ${isActive ? '✅ ACTIVE' : '❌ INACTIVE'}
• Plan: ${latestSub ? latestSub.planType.toUpperCase() : 'None'}
• Expires: ${latestSub ? latestSub.expiresAt.toLocaleDateString() : 'N/A'}

🤖 <b>MT5 Copier:</b>
• Setup: ${latestSub?.mt5Setup ? '✅ CONFIGURED' : '❌ NOT SET UP'}
• Status: ${latestSub?.mt5Setup?.setupStatus.toUpperCase() || 'N/A'}

━━━━━━━━━━━━━━━━━━━

💳 <b>History:</b>
• Total Subs: ${subscriptions.length}
• Total Spent: ₦${(subscriptions.reduce((acc, s) => acc + s.amountKobo, 0) / 100).toLocaleString()}`

    await sendMessage(admin.id, response)
  } catch (error) {
    console.error('Error in handleCheckUser:', error)
    await sendMessage(admin.id, '❌ Failed to look up user.')
  }
}

/**
 * Handle /verify_basic command
 */
async function handleVerifyBasic(user: TelegramUser, reference: string): Promise<void> {
  await handleVerify(user, reference, 'basic')
}

/**
 * Handle /verify_biweekly command
 */
async function handleVerifyBiweekly(user: TelegramUser, reference: string): Promise<void> {
  await handleVerify(user, reference, 'biweekly')
}

/**
 * Handle /verify_monthly command
 */
async function handleVerifyMonthly(user: TelegramUser, reference: string): Promise<void> {
  await handleVerify(user, reference, 'monthly')
}

/**
 * Handle /verify_promo command
 */
async function handleVerifyPromo(user: TelegramUser, reference: string): Promise<void> {
  await handleVerify(user, reference, 'promo')
}

/**
 * Handle /verify_premium command
 */
async function handleVerifyPremium(user: TelegramUser, reference: string): Promise<void> {
  await handleVerify(user, reference, 'premium')
}

/**
 * Handle /promo command
 */
async function handlePromo(from: TelegramUser, args: string[]): Promise<void> {
  // Usage: /promo CODE
  if (!args[0]) {
    // Only show promo codes to admins
    if (from.id === ADMIN_ID) {
      await sendMessage(from.id, `🎁 <b>Promo Codes (Admin View)</b>

━━━━━━━━━━━━━━━━━━━

<b>Available Promo Codes:</b>

✨ <b>EXTRA</b> - 1 Week Premium + Meta Copier (FREE)
✨ <b>EXTRA2</b> - 2 Weeks Premium + Meta Copier (FREE)
✨ <b>VIP</b> - 1 Week Basic Only (FREE)
✨ <b>DISCOUNT</b> - 1 Week Basic (₦3,000) - Generates payment link

━━━━━━━━━━━━━━━━━━━

<b>How to redeem:</b>
/promo EXTRA
/promo EXTRA2
/promo VIP
/promo DISCOUNT

━━━━━━━━━━━━━━━━━━━

<i>All promo codes are one-time use per user</i>`)
    } else {
      await sendMessage(from.id, `🎁 <b>Have a Promo Code?</b>

━━━━━━━━━━━━━━━━━━━

To redeem a promo code, use:
/promo YOUR_CODE

━━━━━━━━━━━━━━━━━━━

<b>Example:</b>
/promo EXTRA

━━━━━━━━━━━━━━━━━━━

<i>Contact admin if you have questions!</i>`)
    }
  } else {
    // Treat the promo code as a reference for 'basic' plan verification
    // This is how the existing logic was structured
    await handleVerify(from, args[0], 'basic')
  }
}

/**
 * Handle payment verification
 */
async function handleVerify(user: TelegramUser, reference: string, planType: PlanType): Promise<void> {
  const userId = user.id.toString()
  const cleanRef = reference.trim()

  // Idempotency check: Don't process the same reference twice
  if (processingReferences.has(cleanRef)) {
    await sendMessage(user.id, `⏳ <b>Already Processing!</b>\n\n━━━━━━━━━━━━━━━━━━━\n\nThis reference is currently being verified. Please wait a moment...`)
    return
  }

  // Add to processing set
  processingReferences.add(cleanRef)

  try {
    // Check rate limit
    if (isRateLimited(userId)) {
      await sendMessage(user.id, '❌ Too many failed verification attempts. Please try again in 1 hour.')
      return
    }

    // Validate reference format
    if (!reference || reference.trim().length === 0) {
      await sendMessage(user.id, `❌ <b>No Reference Provided!</b>\n\n━━━━━━━━━━━━━━━━━━━\n\nPlease paste your transaction reference from your email below!`)
      return
    }

    // Check for existing active subscription to calculate stacked expiry
    const lastActiveSub = await prisma.subscription.findFirst({
      where: {
        telegramUserId: userId,
        isRemoved: false,
        expiresAt: { gt: new Date() }
      },
      orderBy: { expiresAt: 'desc' }
    })
    const currentExpiry = lastActiveSub?.expiresAt

    // Check for promo codes
    const promoCode = cleanRef.toUpperCase()

    // 1. Check for custom promo codes in database
    const customPromo = await prisma.promoCode.findUnique({
      where: { code: promoCode }
    })

    if (customPromo) {
      if (!customPromo.isActive || new Date(customPromo.expiresAt) < new Date()) {
        await sendMessage(user.id, `❌ <b>Promo Expired or Inactive</b>\n\nType /pay to see our regular plans!`)
        return
      }

      if (customPromo.usageLimit && customPromo.usageCount >= customPromo.usageLimit) {
        await sendMessage(user.id, `❌ <b>Promo Limit Reached</b>\n\nType /pay to see our regular plans!`)
        return
      }

      // Check if user has already used this promo
      const userPromoUsageCount = await prisma.subscription.count({
        where: {
          telegramUserId: userId,
          paystackRef: { equals: cleanRef, mode: 'insensitive' }
        }
      })

      if (userPromoUsageCount >= customPromo.perUserLimit) {
        await sendMessage(user.id, `❌ <b>Already Redeemed!</b>\n\nYou've already used this promo code. Type /pay to see our plans!`)
        return
      }

      if (customPromo.isFree) {
        const expiresAt = calculateExpiryDate(customPromo.planType as PlanType, currentExpiry)

        const newSubscription = await prisma.subscription.create({
          data: {
            telegramUserId: userId,
            telegramUsername: user.username,
            telegramName: user.first_name,
            paystackRef: cleanRef,
            amountKobo: 0,
            planType: customPromo.planType as PlanType,
            hasCopierAccess: customPromo.hasCopierAccess,
            startedAt: new Date(),
            expiresAt: expiresAt,
            inviteLinkUsed: lastActiveSub?.inviteLinkUsed || ''
          }
        })

        // Migrate MT5 setup from old active sub if renewing a copier plan
        if (customPromo.hasCopierAccess) {
          const activeMt5 = await prisma.mt5Setup.findFirst({
            where: { subscription: { telegramUserId: userId, isRemoved: false, id: { not: newSubscription.id } } },
            orderBy: { createdAt: 'desc' }
          })
          if (activeMt5) {
            await prisma.mt5Setup.update({ where: { id: activeMt5.id }, data: { subscriptionId: newSubscription.id } })
            console.log(`Migrated MT5 setup ${activeMt5.id} to promo subscription ${newSubscription.id}`)
          }
        }

        await prisma.promoCode.update({
          where: { code: promoCode },
          data: { usageCount: customPromo.usageCount + 1 }
        })

        // Unban user before creating invite link (in case they were previously banned)
        if (!lastActiveSub) {
          const unbanResult = await unbanChatMember(userId)
          console.log(`[handleVerify - Promo] Unbanned user ${userId} before creating invite link. Result: ${unbanResult}`)
        }

        let inviteLink = lastActiveSub?.inviteLinkUsed || await createInviteLink() || ''

        if (lastActiveSub) {
          await sendMessage(user.id, `🎉 <b>Subscription Extended!</b>\n\n━━━━━━━━━━━━━━━━━━━\n\n✅ <b>${customPromo.name || customPromo.code} Promo Applied!</b>\n\n📅 <b>New Expiry:</b> ${expiresAt.toLocaleDateString()}\n\n━━━━━━━━━━━━━━━━━━━\n\nYour access has been extended. You are already in the VIP channel!`)
        } else {
          await sendMessage(user.id, `🎉 <b>Promo Activated!</b>\n\n━━━━━━━━━━━━━━━━━━━\n\n✅ <b>${customPromo.name || customPromo.code} Promo - ${customPromo.durationDays} Days!</b>\n\n📅 <b>Expires:</b> ${expiresAt.toLocaleDateString()}\n\n━━━━━━━━━━━━━━━━━━━\n\n🔗 <b>Join Channel:</b>\n${inviteLink}`)
        }
        return
      } else {
        // PAID custom promo - generate link
        const promoResponse = await fetch(`${APP_URL}/api/payment/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telegramId: userId,
            telegramUsername: user.username || 'unknown',
            planType: 'custom',
            email: `${user.username || 'user'}@pearsignals.com`,
            metadata: { promoCode: promoCode, customPromoId: customPromo.id }
          })
        })
        const promoData = await promoResponse.json()
        if (promoData.success) {
          await sendMessageWithKeyboard(user.id, `🎁 <b>Special Offer!</b>\n\n━━━━━━━━━━━━━━━━━━━\n\n✨ <b>Get ${customPromo.durationDays} Days for ₦${(customPromo.amountKobo! / 100).toLocaleString()}!</b>`, {
            inline_keyboard: [[{ text: `🔥 Pay Now`, url: promoData.authorizationUrl }]]
          })
        }
        return
      }
    }

    // 2. Check for hardcoded promo codes
    if (['EXTRA', 'EXTRA2', 'VIP'].includes(promoCode)) {
      const existingRedemption = await prisma.subscription.findFirst({
        where: { telegramUserId: userId, paystackRef: { equals: promoCode, mode: 'insensitive' } }
      })

      if (existingRedemption) {
        await sendMessage(user.id, `❌ <b>Already Redeemed!</b>\n\nYou've already used this promo code!`)
        return
      }

      const plan: PlanType = promoCode === 'VIP' ? 'basic' : 'premium'
      const expiresAt = calculateExpiryDate(plan, currentExpiry)

      const newSubscription = await prisma.subscription.create({
        data: {
          telegramUserId: userId,
          telegramUsername: user.username,
          telegramName: user.first_name,
          paystackRef: promoCode,
          amountKobo: 0,
          planType: plan,
          hasCopierAccess: plan === 'premium',
          startedAt: new Date(),
          expiresAt: expiresAt,
          inviteLinkUsed: lastActiveSub?.inviteLinkUsed || ''
        }
      })

      // Migrate MT5 setup from old active sub if renewing a copier plan
      if (plan === 'premium') {
        const activeMt5 = await prisma.mt5Setup.findFirst({
          where: { subscription: { telegramUserId: userId, isRemoved: false, id: { not: newSubscription.id } } },
          orderBy: { createdAt: 'desc' }
        })
        if (activeMt5) {
          await prisma.mt5Setup.update({ where: { id: activeMt5.id }, data: { subscriptionId: newSubscription.id } })
          console.log(`Migrated MT5 setup ${activeMt5.id} to promo subscription ${newSubscription.id}`)
        }
      }

      // Unban user before creating invite link (in case they were previously banned)
      if (!lastActiveSub) {
        const unbanResult = await unbanChatMember(userId)
        console.log(`[handleVerify - Hardcoded Promo] Unbanned user ${userId} before creating invite link. Result: ${unbanResult}`)
      }

      let inviteLink = lastActiveSub?.inviteLinkUsed || await createInviteLink() || ''
      await sendMessage(user.id, `🎉 <b>${promoCode} Activated!</b>\n\n━━━━━━━━━━━━━━━━━━━\n\n📅 <b>Expires:</b> ${expiresAt.toLocaleDateString()}\n\n━━━━━━━━━━━━━━━━━━━\n\n${lastActiveSub ? 'Your access has been extended!' : `🔗 <b>Join Channel:</b>\n${inviteLink}`}`)
      return
    }

    if (promoCode === 'DISCOUNT') {
      const promoResponse = await fetch(`${APP_URL}/api/payment/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: userId,
          telegramUsername: user.username || 'unknown',
          planType: 'promo',
          email: `${user.username || 'user'}@pearsignals.com`,
          metadata: { promoCode: 'DISCOUNT' }
        })
      })
      const promoData = await promoResponse.json()
      if (promoData.success) {
        await sendMessageWithKeyboard(user.id, `🎁 <b>DISCOUNT Offer!</b>\n\n━━━━━━━━━━━━━━━━━━━\n\n✨ <b>Get 1 Week Basic for ₦3,000!</b>`, {
          inline_keyboard: [[{ text: '🔥 Pay ₦3,000', url: promoData.authorizationUrl }]]
        })
      }
      return
    }

    // 3. Normal Paystack Verification
    const existingVer = await prisma.subscription.findFirst({ where: { paystackRef: cleanRef } })
    if (existingVer) {
      await sendMessage(user.id, `❌ <b>Reference Already Used!</b>`)
      return
    }

    const verification = await verifyTransaction(cleanRef)
    if (!verification.success || verification.status !== 'success') {
      await sendMessage(user.id, `❌ <b>Verification Failed!</b>\n\nPlease check your reference or complete payment.`)
      return
    }

    // Validate plan amount
    let expectedAmount: number = PLANS[planType].amountKobo
    const vPlanName = PLANS[planType].name

    // Check discount eligibility if it's a standard paid plan (not promo or trial)
    if (planType !== 'trial' && planType !== 'promo' && TRIAL_DISCOUNT.enabled) {
      const now = new Date()
      const twentyFourHoursAgo = new Date(now.getTime() - (TRIAL_DISCOUNT.discountDurationHours * 60 * 60 * 1000))

      const recentTrial = await prisma.subscription.findFirst({
        where: {
          telegramUserId: userId,
          planType: 'trial',
          expiresAt: { gte: twentyFourHoursAgo }
        },
        orderBy: { expiresAt: 'desc' }
      })

      if (recentTrial && recentTrial.expiresAt >= twentyFourHoursAgo) {
        const hoursSinceTrial = Math.floor((now.getTime() - recentTrial.expiresAt.getTime()) / (60 * 60 * 1000))
        const hoursRemaining = Math.max(0, TRIAL_DISCOUNT.discountDurationHours - hoursSinceTrial)
        if (hoursRemaining > 0) {
          // Apply 20% discount
          expectedAmount = Math.floor(expectedAmount * (1 - TRIAL_DISCOUNT.discountPercent / 100))
        }
      }
    }

    if (!validatePaymentAmount(verification.amount!, expectedAmount).valid) {
      await sendMessage(user.id, `❌ <b>Amount Mismatch!</b>\n\nThis payment does not match the ${vPlanName} plan.`)
      return
    }

    // Stacking logic for paid plans
    const expiresAt = calculateExpiryDate(planType, currentExpiry)

    let newSubscription;
    try {
      newSubscription = await prisma.subscription.create({
        data: {
          telegramUserId: userId,
          telegramUsername: user.username,
          telegramName: `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`,
          paystackRef: cleanRef,
          customerEmail: verification.customerEmail,
          amountKobo: verification.amount!,
          planType,
          hasCopierAccess: PLANS[planType].hasCopierAccess,
          startedAt: new Date(),
          expiresAt: expiresAt,
          inviteLinkUsed: lastActiveSub?.inviteLinkUsed || ''
        }
      })

      // Migrate existing MT5 Setup so it stays active across overlapping premium plans
      if (PLANS[planType].hasCopierAccess) {
        const activeMt5 = await prisma.mt5Setup.findFirst({
          where: { subscription: { telegramUserId: userId, isRemoved: false, id: { not: newSubscription.id } } },
          orderBy: { createdAt: 'desc' }
        })
        if (activeMt5) {
          await prisma.mt5Setup.update({ where: { id: activeMt5.id }, data: { subscriptionId: newSubscription.id } })
          console.log(`Migrated MT5 setup ${activeMt5.id} from older subscription to new subscription ${newSubscription.id}`)
        }
      }
    } catch (e) {
      console.error('Save error:', e)
      await sendMessage(user.id, '❌ <b>Database Error</b>\n\nFailed to save your subscription. Please contact support.')
      return
    }

    resetRateLimit(userId)
    const formattedExpiry = expiresAt.toLocaleDateString()

    if (lastActiveSub) {
      await sendMessage(user.id, `✅ <b>Subscription Extended!</b>\n\n━━━━━━━━━━━━━━━━━━━\n\n💎 <b>Plan:</b> ${vPlanName}\n📅 <b>New Expiry:</b> ${formattedExpiry}\n\n━━━━━━━━━━━━━━━━━━━\n\nYou are already in the VIP channel!`)
    } else {
      // Unban user before creating invite link (in case they were previously banned)
      const unbanResult = await unbanChatMember(user.id)
      console.log(`[${handleVerify.name}] Unbanned user ${user.id} before creating invite link. Result: ${unbanResult}`)

      const inviteLink = await createInviteLink()
      await sendMessage(user.id, `✅ <b>Payment Verified!</b>\n\n━━━━━━━━━━━━━━━━━━━\n\n💎 <b>Plan:</b> ${vPlanName}\n📅 <b>Expires:</b> ${formattedExpiry}\n\n━━━━━━━━━━━━━━━━━━━\n\n🔗 <b>Join Channel:</b>\n${inviteLink}`)
    }

    // AUTO-FLOW for Premium (Copier Access)
    if (PLANS[planType].hasCopierAccess) {
      const currentMt5 = await prisma.mt5Setup.findUnique({
        where: { subscriptionId: newSubscription.id }
      })

      // If no setup was migrated, prompt them as a new user
      if (!currentMt5) {
        await setConversationState(userId, { step: 'account_number', data: {} })
        await sendMessage(user.id, `🤖 <b>Copier Access Detected!</b>\n\n━━━━━━━━━━━━━━━━━━━\n\nLet's set up your MT5 Copier.\n\nPlease send your <b>MT5 Account Number</b> to begin!`)
      }
    }
  } catch (error) {
    console.error('Verify error:', error)
    await sendMessage(user.id, '❌ <b>System Error</b>\n\nAn unexpected error occurred. Please try again later.')
  } finally {
    // Always remove from processing set (idempotency cleanup)
    processingReferences.delete(cleanRef)
  }
}


/**
 * Handle /status command
 */
async function handleStatus(user: TelegramUser): Promise<void> {
  const userId = user.id.toString()

  const subscription = await prisma.subscription.findFirst({
    where: {
      telegramUserId: userId,
      isRemoved: false,
      expiresAt: { gte: new Date() }
    },
    orderBy: { createdAt: 'desc' }
  })

  if (!subscription) {
    await sendMessage(user.id, '❌ No active subscription found.\n\nType /start to see payment details and get access.')
    return
  }

  const planName = PLANS[subscription.planType as PlanType].name
  const daysRemaining = getDaysRemaining(subscription.expiresAt)
  const formattedStart = formatDate(subscription.startedAt)
  const formattedExpiry = formatDate(subscription.expiresAt)

  let statusMessage = `✅ Your subscription is ACTIVE

💎 Plan: ${planName}
📅 Started: ${formattedStart}
⏰ Expires: ${formattedExpiry} (${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining)`

  if (subscription.hasCopierAccess) {
    statusMessage += '\n\n🤖 Auto Copier Bot: ENABLED'
  }

  statusMessage += '\n\nYou currently have access to the channel.'

  await sendMessage(user.id, statusMessage)
}

/**
 * Handle unknown text message
 */
async function handleUnknown(user: TelegramUser): Promise<void> {
  await sendMessage(user.id, `👋 Welcome! Please use a command:

/start - Get started and see payment details
/verify_basic REF - Verify Basic plan payment
/verify_biweekly REF - Verify Bi-Weekly plan payment
/verify_monthly REF - Verify Monthly plan payment
/verify_premium REF - Verify Premium plan payment
/status - Check your subscription
/mt5setup - Setup MT5 copier (Premium only)
/settings - Configure copier settings (Premium only)
/mystats - View copier status (Premium only)
/help - Get help`)
}

/**
 * Handle /mt5setup command - Start MT5 account setup flow
 */
async function handleMt5Setup(user: TelegramUser): Promise<void> {
  const userId = user.id.toString()

  console.log(`[/mt5setup] Command triggered by user ${userId}`)

  // Check if user has active Premium subscription with copier access
  const subscription = await prisma.subscription.findFirst({
    where: {
      telegramUserId: userId,
      isRemoved: false,
      expiresAt: { gte: new Date() },
      hasCopierAccess: true
    },
    include: { mt5Setup: true },
    orderBy: { createdAt: 'desc' }
  })

  console.log(`[/mt5setup] Subscription found: ${!!subscription}, hasMt5Setup: ${!!subscription?.mt5Setup}`)

  if (!subscription) {
    // Check if they ever had a Premium subscription that expired
    const expiredSub = await prisma.subscription.findFirst({
      where: {
        telegramUserId: userId,
        hasCopierAccess: true,
        isRemoved: false
      },
      orderBy: { createdAt: 'desc' }
    })

    if (expiredSub && expiredSub.expiresAt < new Date()) {
      // They had Premium but it expired
      const daysSinceExpiry = Math.floor((Date.now() - expiredSub.expiresAt.getTime()) / (1000 * 60 * 60 * 24))

      console.log(`[/mt5setup] User ${userId} has expired Premium subscription (${daysSinceExpiry} days ago)`)
      await sendMessage(user.id, `❌ <b>Your Premium Subscription Has Expired</b>

━━━━━━━━━━━━━━━━━━━

Your Premium subscription expired ${daysSinceExpiry === 0 ? 'today' : daysSinceExpiry === 1 ? 'yesterday' : `${daysSinceExpiry} days ago`}.

The MT5 Auto Copier is only available for active Premium subscribers.

━━━━━━━━━━━━━━━━━━━

<b>Want to renew?</b>
Type /pay to see our Premium plan (₦22,000)

Your subscription will be extended from today!`)
    } else {
      // They never had Premium
      console.log(`[/mt5setup] No Premium subscription found for user ${userId}`)
      await sendMessage(user.id, `❌ <b>MT5 Setup Not Available</b>

━━━━━━━━━━━━━━━━━━━

The MT5 Auto Copier is only available for Premium subscribers.

━━━━━━━━━━━━━━━━━━━

<b>Want to upgrade?</b>
Type /pay to see our Premium plan (₦22,000)`)
    }
    return
  }

  // Check if already set up
  if (subscription.mt5Setup && subscription.mt5Setup.setupStatus === 'active') {
    console.log(`[/mt5setup] User ${userId} already has active MT5 setup`)
    await sendMessage(user.id, `✅ <b>MT5 Already Set Up!</b>

━━━━━━━━━━━━━━━━━━━

Your copier is already active!

<b>Current Settings:</b>
📊 Multiplier: ${subscription.mt5Setup.copierMultiplier}x
📏 Max Lot: ${subscription.mt5Setup.maxLotSize}
🔢 Max Positions: ${subscription.mt5Setup.maxOpenPositions}

━━━━━━━━━━━━━━━━━━━

Use /settings to modify your copier settings.`)
    return
  }

  // Start MT5 setup flow
  console.log(`[/mt5setup] Starting MT5 setup flow for user ${userId}`)
  await setConversationState(userId, {
    step: 'account_number',
    data: {}
  })

  await sendMessage(user.id, `🤖 <b>MT5 Auto Copier Setup</b>

━━━━━━━━━━━━━━━━━━━

Let's set up your MT5 account to automatically copy our trades!

━━━━━━━━━━━━━━━━━━━

⚠️ <b>IMPORTANT REQUIREMENTS:</b>

━━━━━━━━━━━━━━━━━━━

<b>1. YOUR ACCOUNT MUST BE A CENT ACCOUNT!</b>
❌ Standard Account - <b>WILL NOT WORK</b>
✅ Cent Account - <b>REQUIRED</b>

<b>2. SCALING: DISABLED (No Scaling)</b>
💡 Copy trades exactly as master opens them

<b>3. MAGIC NUMBER: 123456</b>
🔢 Set this in your MT5 EA settings

<b>4. BROKER: HEADWAY</b>
🏢 Your account must be with Headway

━━━━━━━━━━━━━━━━━━━

<b>Server:</b> headway-real
<b>Region:</b> London
<b>Account Type:</b> MT5

━━━━━━━━━━━━━━━━━━━

🎁 <b>DON'T HAVE A HEADWAY ACCOUNT?</b>

Create one here and get <b>$100 BONUS!</b>
👉 https://headway.partners/user/signup?hwp=82067c

━━━━━━━━━━━━━━━━━━━

<b>Step 1 of 2:</b>
Please send your MT5 account number:

<i>Example: 123456789</i>

Make sure it's a <b>CENT ACCOUNT</b>!`)

  console.log(`[/mt5setup] Setup message sent to user ${userId}`)
}

/**
 * Handle /settings command - Configure copier settings
 */
async function handleSettings(user: TelegramUser): Promise<void> {
  const userId = user.id.toString()

  // Check if user has active Premium subscription with MT5 setup

  const subscription = await prisma.subscription.findFirst({
    where: {
      telegramUserId: userId,
      isRemoved: false,
      expiresAt: { gte: new Date() },
      hasCopierAccess: true
    },
    include: { mt5Setup: true },
    orderBy: { createdAt: 'desc' }
  })

  if (!subscription || !subscription.mt5Setup || subscription.mt5Setup.setupStatus !== 'active') {
    await sendMessage(user.id, `❌ <b>Settings Not Available</b>

━━━━━━━━━━━━━━━━━━━

You need to complete MT5 setup first.

Use /mt5setup to get started.`)
    return
  }

  // Display settings menu
  await sendMessageWithKeyboard(
    user.id,
    `⚙️ <b>Copier Settings</b>

━━━━━━━━━━━━━━━━━━━

Configure your trade copying settings:

━━━━━━━━━━━━━━━━━━━`,
    settingsKeyboard({
      copierMultiplier: subscription.mt5Setup.copierMultiplier,
      lotSize: subscription.mt5Setup.lotSize || 0.01,
      maxLotSize: subscription.mt5Setup.maxLotSize,
      maximumLot: subscription.mt5Setup.maximumLot || 0.2,
      maxOpenPositions: subscription.mt5Setup.maxOpenPositions,
      copyStopLoss: subscription.mt5Setup.copyStopLoss,
      copyTakeProfit: subscription.mt5Setup.copyTakeProfit,
      tp2Enabled: subscription.mt5Setup.tp2Enabled
    })
  )
}

/**
 * Handle /mystats command - View copier status
 */
async function handleMyStats(user: TelegramUser): Promise<void> {
  const userId = user.id.toString()

  const subscription = await prisma.subscription.findFirst({
    where: {
      telegramUserId: userId,
      isRemoved: false,
      expiresAt: { gte: new Date() },
      hasCopierAccess: true
    },
    include: { mt5Setup: true },
    orderBy: { createdAt: 'desc' }
  })

  if (!subscription || !subscription.mt5Setup) {
    await sendMessage(user.id, `❌ No MT5 setup found.

Use /mt5setup to get started.`)
    return
  }

  const mt5 = subscription.mt5Setup
  const statusEmoji = mt5.setupStatus === 'active' ? '✅' : mt5.setupStatus === 'pending' ? '⏳' : '❌'

  await sendMessage(user.id, `${statusEmoji} <b>MT5 Copier Status</b>

━━━━━━━━━━━━━━━━━━━

<b>Account:</b> ${mt5.loginAccountNumber}
<b>Server:</b> ${mt5.loginServer}
<b>Region:</b> ${mt5.regionId === 2 ? 'London' : `Region ${mt5.regionId}`}
<b>Status:</b> ${mt5.setupStatus.toUpperCase()}

━━━━━━━━━━━━━━━━━━━

<b>Copy Settings:</b>
📊 Multiplier: ${mt5.copierMultiplier}x
📏 Max Lot: ${mt5.maxLotSize}
🔢 Max Positions: ${mt5.maxOpenPositions}
🛑 Copy SL: ${mt5.copyStopLoss ? '✅' : '❌'}
🎯 Copy TP: ${mt5.copyTakeProfit ? '✅' : '❌'}
🚀 Take TP2: ${mt5.tp2Enabled ? '✅' : '❌'}

━━━━━━━━━━━━━━━━━━━

Use /settings to modify.`)
}

/**
 * Handle /remove_copier command - Remove MT5 account from MetaCopier
 */
async function handleRemoveCopier(user: TelegramUser): Promise<void> {
  const userId = user.id.toString()

  // Check if user has active Premium subscription with MT5 setup
  const subscription = await prisma.subscription.findFirst({
    where: {
      telegramUserId: userId,
      isRemoved: false,
      expiresAt: { gte: new Date() },
      hasCopierAccess: true
    },
    include: { mt5Setup: true },
    orderBy: { createdAt: 'desc' }
  })

  if (!subscription || !subscription.mt5Setup) {
    await sendMessage(user.id, `❌ <b>No Copier Found</b>

━━━━━━━━━━━━━━━━━━━

You don't have an active MT5 copier setup.

Use /mt5setup to set up a new copier.`)
    return
  }

  const mt5 = subscription.mt5Setup

  // Check if MetaCopier account exists
  if (!mt5.metacopierAccountId) {
    await sendMessage(user.id, `❌ <b>No MetaCopier Account</b>

━━━━━━━━━━━━━━━━━━━

Your MT5 setup doesn't have a MetaCopier account to remove.

Contact support if this is an error.`)
    return
  }

  try {
    console.log(`[Remove Copier] Starting removal for user ${userId}, account index: ${mt5.metacopierAccountIndex ?? 0}`)

    // Actually remove the account from MetaCopier API
    const result = await removeUserMt5Account(
      mt5.metacopierAccountId ?? '',
      mt5.metacopierCopierId ?? '',
      mt5.metacopierAccountIndex ?? 0
    )

    if (!result.success) {
      await sendMessage(user.id, `❌ <b>Removal Failed</b>

━━━━━━━━━━━━━━━━━━━

Failed to remove MetaCopier account: ${result.error || 'Unknown error'}

━━━━━━━━━━━━━━━━━━━

Please try again later.`)
      return
    }

    console.log(`[Remove Copier] Auto-deleting database record and notifying admin for user ${userId}`)

    // Store details before deletion
    const accountNumber = mt5.loginAccountNumber
    const metaCopierAccountId = mt5.metacopierAccountId
    const metaCopierCopierId = mt5.metacopierCopierId
    const lotSize = mt5.lotSize
    const maxPositions = mt5.maxOpenPositions
    const planType = subscription.planType
    const expiryDate = subscription.expiresAt.toLocaleDateString()
    const amount = `₦${(subscription.amountKobo / 100).toLocaleString()}`
    const mt5SetupId = mt5.id

    // Delete from database immediately
    await prisma.mt5Setup.delete({
      where: { id: mt5.id }
    })

    console.log(`[Remove Copier] Database record deleted for user ${userId}, account ${accountNumber}`)

    // Send message to admin with account details for manual MetaCopier deletion
    await sendMessage(ADMIN_ID, `🗑️ <b>Copier Removal Request - Database Deleted</b>

━━━━━━━━━━━━━━━━━━━

<b>User Details:</b>
👤 Name: ${user.first_name || user.username || 'Unknown'}
🆔 Telegram ID: ${userId}
📝 Username: @${user.username || 'N/A'}

<b>MT5 Account Details:</b>
📊 Account Number: ${accountNumber}
🔹 MetaCopier Account ID: ${metaCopierAccountId}
🔸 MetaCopier Copier ID: ${metaCopierCopierId || 'N/A'}
💾 Lot Size: ${lotSize}
📈 Max Positions: ${maxPositions}

━━━━━━━━━━━━━━━━━━━

<b>Subscription Info:</b>
📅 Plan: ${planType}
⏰ Expires: ${expiryDate}
💰 Amount: ${amount}

━━━━━━━━━━━━━━━━━━━

✅ <b>Database record auto-deleted</b>
⚠️ <b>Action Required:</b> Please manually delete from MetaCopier website

MetaCopier: https://metacopier.io`)

    // Send confirmation to user
    await sendMessage(user.id, `✅ <b>Copier Removed Successfully</b>

━━━━━━━━━━━━━━━━━━━

Your MT5 copier account has been successfully deleted.

<b>Account:</b> ${accountNumber}

━━━━━━━━━━━━━━━━━━━

⚠️ <b>Important:</b>
• Your copier has been removed from our system
• Copying trades has been stopped
• Your Premium subscription remains active

You can set up a new copier anytime using /mt5setup`)

    console.log(`[Remove Copier] Completed removal for user ${userId}, account ${accountNumber}`)
  } catch (error) {
    console.error(`[Remove Copier] Error during removal for user ${userId}:`, error)
    await sendMessage(user.id, `❌ <b>Failed to Remove Copier</b>

━━━━━━━━━━━━━━━━━━━

There was an error removing your copier.

Please try again or contact support directly.`)
  }
}

/**
 * Handle /create_promo command - Admin creates custom promo codes
 */
async function handleCreatePromo(user: TelegramUser): Promise<void> {
  const userId = user.id.toString()

  // Check if admin
  if (user.id !== ADMIN_ID) {
    await sendMessage(user.id, '❌ Only the admin can use this command.')
    return
  }

  // Start conversation state for creating promo
  await setConversationState(userId, {
    step: 'promo_code',
    data: {}
  })

  await sendMessage(user.id, `🎁 <b>Create Promo Code</b>

━━━━━━━━━━━━━━━━━━━

Let's create a custom promo code!

<b>Step 1 of 7:</b>
Send the promo code name (e.g., NEWYEAR, SUMMER2025)

<i>Code must be UPPERCASE, no spaces</i>

━━━━━━━━━━━━━━━━━━━

Type /cancel to exit`)
}

/**
 * Handle /list_promos command - List all promo codes
 */
async function handleListPromos(user: TelegramUser): Promise<void> {
  const userId = user.id.toString()

  // Check if admin
  if (user.id !== ADMIN_ID) {
    await sendMessage(user.id, '❌ Only the admin can use this command.')
    return
  }

  const promos = await prisma.promoCode.findMany({
    orderBy: { createdAt: 'desc' }
  })

  if (promos.length === 0) {
    await sendMessage(user.id, `📋 No promo codes found.

Create one with /create_promo`)
    return
  }

  let message = `📋 <b>All Promo Codes</b> (${promos.length})

━━━━━━━━━━━━━━━━━━━`

  for (const promo of promos) {
    const status = promo.isActive ? '✅ Active' : '❌ Disabled'
    const expiry = new Date(promo.expiresAt) < new Date() ? '❌ Expired' : `📅 ${new Date(promo.expiresAt).toLocaleDateString()}`
    const price = promo.isFree ? 'FREE' : `₦${(promo.amountKobo! / 100).toLocaleString()}`

    message += `\n<b>${promo.code}</b> - ${promo.name || 'No name'}
├─ ${price} • ${promo.planType.toUpperCase()}
├─ ${promo.durationDays} days • ${status}
├─ ${expiry}
├─ Used: ${promo.usageCount}${promo.usageLimit ? `/${promo.usageLimit}` : ' (unlimited)'}
└─ Per user: ${promo.perUserLimit}x

━━━━━━━━━━━━━━━━━━━`
  }

  message += `\n<i>Delete promo: /delete_promo CODE</i>`

  await sendMessage(user.id, message)
}

/**
 * Handle /delete_promo command - Delete a promo code
 */
async function handleDeletePromo(user: TelegramUser, args: string[]): Promise<void> {
  const userId = user.id.toString()

  // Check if admin
  if (user.id !== ADMIN_ID) {
    await sendMessage(user.id, '❌ Only the admin can use this command.')
    return
  }

  if (!args[0]) {
    await sendMessage(user.id, `❌ Please provide a promo code to delete.

Usage: /delete_promo CODE

Example: /delete_promo NEWYEAR`)
    return
  }

  const promoCode = args[0].toUpperCase()

  try {
    await prisma.promoCode.delete({
      where: { code: promoCode }
    })

    await sendMessage(user.id, `✅ <b>Promo Code Deleted</b>

━━━━━━━━━━━━━━━━━━━

<b>Code:</b> ${promoCode}

The promo code has been deleted.`)
  } catch (error) {
    await sendMessage(user.id, `❌ <b>Promo Code Not Found</b>

━━━━━━━━━━━━━━━━━━━

The promo code "${promoCode}" doesn't exist.`)
  }
}

/**
 * Handle promo creation conversation flow
 */
async function handlePromoConversation(user: TelegramUser, text: string): Promise<void> {
  const userId = user.id.toString()
  const state = await getConversationState(userId)

  if (!state) {
    return // Not in promo creation flow
  }

  const trimmedText = text.trim()

  switch (state.step) {
    case 'promo_code': {
      const code = trimmedText.toUpperCase()

      // Validate code format (letters only, no spaces)
      if (!/^[A-Z0-9]+$/.test(code)) {
        await sendMessage(user.id, `❌ Invalid code format!

Code must be UPPERCASE, letters and numbers only, no spaces.

<i>Example: NEWYEAR, SUMMER2025, PROMO50</i>`)
        return
      }

      // Check if code already exists
      const existing = await prisma.promoCode.findUnique({
        where: { code }
      })

      if (existing) {
        await sendMessage(user.id, `❌ Code already exists!

The code "${code}" is already in use.

Please choose a different code.`)
        return
      }

      await updateConversationData(userId, { code })
      await advancePromoStep(userId, 'promo_name')
      await sendMessage(user.id, `✅ Code saved!

━━━━━━━━━━━━━━━━━━━

<b>Step 2 of 7:</b>
What's this promo called? (Optional)

<i>Leave empty to skip</i>`)
      break
    }

    case 'promo_name': {
      const name = trimmedText || null

      await updateConversationData(userId, { name })
      await advancePromoStep(userId, 'plan_type')
      await sendMessage(user.id, `✅ Saved!

━━━━━━━━━━━━━━━━━━━

<b>Step 3 of 7:</b>
What plan type?

<b>Choose:</b>
1. Basic
2. Premium
3. Bi-Weekly
4. Monthly

<i>Send number (1-4)</i>`)
      break
    }

    case 'plan_type': {
      const planMap: Record<string, PlanType> = {
        '1': 'basic',
        '2': 'premium',
        '3': 'biweekly',
        '4': 'monthly'
      }

      const planType = planMap[trimmedText]

      if (!planType) {
        await sendMessage(user.id, `❌ Invalid choice!

Please send 1, 2, 3, or 4`)
        return
      }

      await updateConversationData(userId, { planType })
      await advancePromoStep(userId, 'duration')
      await sendMessage(user.id, `✅ Plan set to ${planType.toUpperCase()}!

━━━━━━━━━━━━━━━━━━━

<b>Step 4 of 7:</b>
How many days?

<i>Send number of days (e.g., 7, 14, 30)</i>`)
      break
    }

    case 'duration': {
      const days = parseInt(trimmedText)

      if (isNaN(days) || days < 1 || days > 365) {
        await sendMessage(user.id, `❌ Invalid duration!

Please enter 1-365 days.`)
        return
      }

      await updateConversationData(userId, { durationDays: days })
      await advancePromoStep(userId, 'is_free')
      await sendMessage(user.id, `✅ ${days} days set!

━━━━━━━━━━━━━━━━━━━

<b>Step 5 of 7:</b>
Is this promo FREE or PAID?

<b>Choose:</b>
1. FREE
2. PAID

<i>Send number (1-2)</i>`)
      break
    }

    case 'is_free': {
      const isFree = trimmedText === '1'

      await updateConversationData(userId, { isFree })
      await advancePromoStep(userId, isFree ? 'has_copier' : 'amount')
      await sendMessage(user.id, `✅ ${isFree ? 'FREE promo!' : 'PAID promo!'}

━━━━━━━━━━━━━━━━━━━

${isFree ? `
<b>Step 6 of 7:</b>
Does this include Meta Copier access?

<b>Choose:</b>
1. YES
2. NO

<i>Send number (1-2)</i>` : `
<b>Step 6 of 7:</b>
How much? (in Naira)

<i>Send amount (e.g., 3000, 5000)</i>`}
━━━━━━━━━━━━━━━━━━━`)
      break
    }

    case 'has_copier': {
      const hasCopierAccess = trimmedText === '1'

      await updateConversationData(userId, { hasCopierAccess: hasCopierAccess })
      await advancePromoStep(userId, 'expiry')
      await sendMessage(user.id, `✅ Copier access ${hasCopierAccess ? 'INCLUDED' : 'NOT included'}!

━━━━━━━━━━━━━━━━━━━

<b>Step 7 of 7:</b>
When does this promo expire?

<i>Send in format: DD/MM/YYYY</i>
<i>Example: 31/12/2025</i>

<i>Leave empty for no expiry</i>`)
      break
    }

    case 'amount': {
      const amount = parseInt(trimmedText)

      if (isNaN(amount) || amount < 100) {
        await sendMessage(user.id, `❌ Invalid amount!

Amount must be at least ₦100.`)
        return
      }

      const amountKobo = amount * 100 // Convert to kobo
      await updateConversationData(userId, { amountKobo })
      await advancePromoStep(userId, 'has_copier')
      await sendMessage(user.id, `✅ ₦${amount.toLocaleString()} set!

━━━━━━━━━━━━━━━━━━━

<b>Step 6 of 7:</b>
Does this include Meta Copier access?

<b>Choose:</b>
1. YES
2. NO

<i>Send number (1-2)</i>`)
      break
    }

    case 'expiry': {
      let expiresAt: Date

      if (trimmedText.length === 0) {
        // No expiry - set to 1 year from now
        expiresAt = new Date()
        expiresAt.setFullYear(expiresAt.getFullYear() + 1)
      } else {
        // Parse date DD/MM/YYYY
        const parts = trimmedText.split('/')
        if (parts.length !== 3) {
          await sendMessage(user.id, `❌ Invalid date format!

Use DD/MM/YYYY format.

Example: 31/12/2025`)
          return
        }

        const day = parseInt(parts[0])
        const month = parseInt(parts[1]) - 1 // Month is 0-indexed
        const year = parseInt(parts[2])

        if (isNaN(day) || isNaN(month) || isNaN(year)) {
          await sendMessage(user.id, `❌ Invalid date!`)
          return
        }

        expiresAt = new Date(year, month, day, 23, 59, 59) // End of that day
      }

      // Get all conversation data
      const data = state.data as any

      // Debug logging
      console.log('[Promo Expiry] Retrieved data:', data)

      // Create the promo code
      try {
        await prisma.promoCode.create({
          data: {
            code: data.code,
            name: data.name,
            planType: data.planType,
            durationDays: data.durationDays,
            hasCopierAccess: data.hasCopierAccess || false,
            isFree: data.isFree,
            amountKobo: data.isFree ? null : data.amountKobo,
            expiresAt: expiresAt,
            createdBy: 'admin',
            isActive: true
          }
        })

        // Clear conversation state
        await clearConversationState(userId)

        const plan = PLANS[data.planType as PlanType]
        const price = data.isFree ? 'FREE' : `₦${(data.amountKobo / 100).toLocaleString()}`
        const expiryText = trimmedText.length === 0 ? '1 year from now' : expiresAt.toLocaleDateString()

        await sendMessage(user.id, `✅ <b>Promo Code Created!</b>

━━━━━━━━━━━━━━━━━━━

<b>Code:</b> ${data.code}
<b>Name:</b> ${data.name || 'No name'}
<b>Plan:</b> ${plan.name}
<b>Duration:</b> ${data.durationDays} days
<b>Price:</b> ${price}
<b>Copier:</b> ${data.hasCopierAccess ? 'Included' : 'No'}
<b>Expires:</b> ${expiryText}

━━━━━━━━━━━━━━━━━━━

<b>Users can redeem with:</b>
/promo ${data.code}

━━━━━━━━━━━━━━━━━━━

<i>Code is active and ready to use!</i>`)
      } catch (error) {
        console.error('Error creating promo code:', error)
        await sendMessage(user.id, `❌ Failed to create promo code.

Please try again.`)
        await clearConversationState(userId)
      }

      break
    }

    default:
      await sendMessage(user.id, `Something went wrong. Please start over with /create_promo`)
      await clearConversationState(userId)
      break
  }
}

/**
 * Handle MT5 setup conversation flow
 */
async function handleMt5Conversation(user: TelegramUser, text: string): Promise<void> {
  const userId = user.id.toString()
  const state = await getConversationState(userId)

  if (!state) {
    return // Not in MT5 setup flow
  }

  const trimmedText = text.trim()

  switch (state.step) {
    case 'account_number':
      // Validate account number (8-12 digits)
      if (!/^\d{8,12}$/.test(trimmedText)) {
        await sendMessage(user.id, `❌ Invalid account number!

Please send a valid MT5 account number (8-12 digits).

<i>Example: 123456789</i>`)
        return
      }

      await updateConversationData(userId, { accountNumber: trimmedText })
      await advanceMt5SetupStep(userId)

      await sendMessage(user.id, `✅ Account number saved!

━━━━━━━━━━━━━━━━━━━

<b>Step 2 of 2:</b>
Please send your MT5 password:

<i>This will be encrypted and stored securely.</i>

⚠️ Make sure this is a <b>CENT ACCOUNT</b> password!`)
      break

    case 'password':
      if (trimmedText.length < 4) {
        await sendMessage(user.id, `❌ Password too short!

Please send your valid MT5 password.`)
        return
      }

      await updateConversationData(userId, { password: trimmedText })

      // Auto-set server to headway-real
      const defaultServer = 'headway-real'
      await updateConversationData(userId, { server: defaultServer })
      await advanceMt5SetupStep(userId) // This will move to 'confirming' step

      // Show confirmation
      const finalState = await getConversationState(userId)
      if (finalState) {
        await sendMessageWithKeyboard(
          user.id,
          `✅ <b>Confirm MT5 Setup</b>

━━━━━━━━━━━━━━━━━━━

<b>Account:</b> ${finalState.data.accountNumber}
<b>Server:</b> ${defaultServer}
<b>Region:</b> London

━━━━━━━━━━━━━━━━━━━

⚠️ <b>DOUBLE-CHECK BEFORE CONFIRMING:</b>

✅ Is this a <b>CENT ACCOUNT</b>?
✅ Magic Number set to <b>123456</b>?
✅ Scaling is <b>DISABLED</b>?

━━━━━━━━━━━━━━━━━━━

<b>Copy Settings (Simple Terms):</b>

📊 <b>Lot Size (0.01):</b>
<i>"When master opens 0.01, you also open 0.01"</i>

<b>Want bigger trades?</b>
• 0.01 = Same size as master (safe) ✅
• 0.02 = Double the size (more profit) 📈
• 0.03 = Triple the size (higher risk) 🚀

<b>Change anytime with /settings!</b>

📏 <b>Max Lot Per Trade (0.02):</b>
<i>"Biggest trade we'll copy is 0.02 lots"</i>

🔢 <b>Max Positions (10):</b>
<i>"Maximum 10 trades open at same time"</i>

━━━━━━━━━━━━━━━━━━━

🎁 <b>DON'T HAVE A HEADWAY ACCOUNT?</b>

Create one here and get <b>$100 BONUS!</b>
👉 https://headway.partners/user/signup?hwp=82067c

━━━━━━━━━━━━━━━━━━━

Please confirm to activate your copier:`,
          confirmSetupKeyboard()
        )
      }
      break

    case 'confirming':
      await sendMessage(user.id, `⏳ Please use the buttons to confirm or cancel.`)
      break
  }
}

/**
 * Process MT5 setup and create MetaCopier account
 */
async function processMt5Setup(user: TelegramUser): Promise<boolean> {
  const userId = user.id.toString()
  const state = await getConversationState(userId)

  // Debug logging
  console.log(`[MT5 Setup] Processing for user ${userId}`)
  console.log(`[MT5 Setup] State exists: ${!!state}`)
  if (state) {
    console.log(`[MT5 Setup] Step: ${state.step}`)
    console.log(`[MT5 Setup] Has accountNumber: ${!!state.data.accountNumber}`)
    console.log(`[MT5 Setup] Has password: ${!!state.data.password}`)
    console.log(`[MT5 Setup] Has server: ${!!state.data.server}`)
  }

  if (!state || !state.data.accountNumber || !state.data.password || !state.data.server) {
    await sendMessage(user.id, `❌ <b>Setup session expired!</b>

This happens when:
• The server restarted
• Too much time passed between steps

<b>Please start fresh:</b>
/mt5setup

💡 <i>Tip: Complete all steps within 5 minutes to avoid timeout.</i>`)
    await clearConversationState(userId)
    return false
  }

  try {
    // Get user's subscription
    const subscription = await prisma.subscription.findFirst({
      where: {
        telegramUserId: userId,
        isRemoved: false,
        expiresAt: { gte: new Date() },
        hasCopierAccess: true
      },
      orderBy: { createdAt: 'desc' }
    })

    if (!subscription) {
      await sendMessage(user.id, `❌ No active Premium subscription found.`)
      await clearConversationState(userId)
      return false
    }

    await sendMessage(user.id, `⏳ Creating your MetaCopier account...
This may take 10-20 seconds.`)

    // Create MetaCopier account (now with automatic fallback to secondary account)
    const { account: mcAccount, accountIndex } = await createMt5Account({
      loginAccountNumber: state.data.accountNumber,
      loginAccountPassword: state.data.password,
      loginServer: state.data.server,
      region: { id: 2 }, // 2 = London region in MetaCopier
      type: { id: 1 }    // 1 = MT5 account type in MetaCopier
    })

    // Encrypt password
    const encryptedPassword = encryptPassword(state.data.password)

    // Save to database with account index
    await prisma.mt5Setup.create({
      data: {
        subscriptionId: subscription.id,
        loginAccountNumber: state.data.accountNumber,
        loginAccountPassword: encryptedPassword,
        loginServer: state.data.server,
        regionId: 2, // London region ID in MetaCopier
        metacopierAccountId: mcAccount.accountId,
        metacopierCopierId: mcAccount.copierId,
        metacopierAccountIndex: accountIndex, // Store which account was used (0 or 1)
        setupStatus: 'active'
      }
    })

    // Clear conversation state
    await clearConversationState(userId)

    await sendMessage(user.id, `✅ <b>Copier Activated Successfully!</b>

━━━━━━━━━━━━━━━━━━━

Your MT5 account is now copying our master trades!

━━━━━━━━━━━━━━━━━━━

<b>Account:</b> ${state.data.accountNumber}
<b>Server:</b> ${state.data.server}
<b>Region:</b> London

━━━━━━━━━━━━━━━━━━━

⚠️ <b>IMPORTANT - VERIFY YOUR MT5 SETTINGS:</b>

✅ Account Type: <b>CENT ACCOUNT</b>
✅ Scaling: <b>DISABLED</b> (No Scaling)
✅ Magic Number: <b>123456</b>

━━━━━━━━━━━━━━━━━━━

<b>Your Copy Settings:</b>

📊 <b>Lot Size: 0.01</b>
<i>"When master opens 0.01 lots, you also open 0.01 lots"</i>

<b>Want to increase your lot size?</b>
• 0.01 = Copy same size as master (safe) ✅
• 0.02 = Double the size (more profit, more risk) 📈
• 0.03 = Triple the size (higher risk) 🚀

<b>Change anytime with /settings!</b>

━━━━━━━━━━━━━━━━━━━

📏 <b>Max Lot Per Trade: 0.02</b>
<i>"Biggest trade we'll copy is 0.02 lots"</i>

🔢 <b>Max Positions: 10</b>
<i>"Maximum 10 trades at the same time"</i>

🛑 Copy SL: ✅
🎯 Copy TP: ✅

━━━━━━━━━━━━━━━━━━━

Use /settings to modify your settings anytime!
Use /mystats to view your copier status!`)

    return true
  } catch (error) {
    console.error('Error processing MT5 setup:', error)

    // Check for specific error types
    const errorMessage = error instanceof Error ? error.message : String(error)
    let userMessage = ''

    if (errorMessage.includes('ACCOUNT_LIMIT_PER_PROJECT_REACHED_TRIAL')) {
      userMessage = `❌ <b>Service Capacity Full!</b>

━━━━━━━━━━━━━━━━━━━

We have reached our temporary capacity limit for this project.

━━━━━━━━━━━━━━━━━━━

<b>What this means:</b>
• The MetaCopier trial limit has been reached.
• We are working to upgrade our capacity soon.
• Please try again in 24 hours.

━━━━━━━━━━━━━━━━━━━

💡 <i>We apologize for the delay!</i>`
    } else if (errorMessage.includes('Status 401') || errorMessage.includes('Empty response')) {
      userMessage = `❌ <b>Service Authentication Error!</b>

━━━━━━━━━━━━━━━━━━━

There is a configuration issue with our connection to MetaCopier.

━━━━━━━━━━━━━━━━━━━

<b>Error Detail:</b>
• The secondary API key is invalid or deactivated.

━━━━━━━━━━━━━━━━━━━

<i>Admin has been notified to fix the API credentials. Please try again later!</i>`
    } else if (errorMessage.includes('LOGIN_SERVER_NOT_FOUND')) {
      userMessage = `❌ <b>Server Not Found!</b>

━━━━━━━━━━━━━━━━━━━

<b>The MT5 server name you entered doesn't exist.</b>

━━━━━━━━━━━━━━━━━━━

<b>Common server names:</b>

<b>Headway:</b>
<code>headway-real</code>

<b>Exness:</b>
<code>Exness-MT5Real</code>

<b>IC Markets:</b>
<code>ICMarketsSC-MT5</code>

━━━━━━━━━━━━━━━━━━━

<b>How to find your server:</b>
1. Open your MT5 terminal
2. Click <b>File → Login → Trade</b> tab
3. Copy the server name exactly as shown

━━━━━━━━━━━━━━━━━━━

Type /mt5setup to try again.`
    } else if (errorMessage.includes('authentication') || errorMessage.includes('credentials') || errorMessage.includes('invalid') || errorMessage.includes('403')) {
      userMessage = `❌ <b>Invalid MT5 Credentials!</b>

━━━━━━━━━━━━━━━━━━━

<b>The password or account number is incorrect.</b>

━━━━━━━━━━━━━━━━━━━

<b>Please double-check:</b>
• MT5 account number is correct
• MT5 password is correct
• Account is a <b>CENT ACCOUNT</b>
• Server is: MT5 | Headway-Live

━━━━━━━━━━━━━━━━━━━

Type /mt5setup to try again.`
    } else if (errorMessage.includes('connection') || errorMessage.includes('timeout') || errorMessage.includes('network')) {
      userMessage = `❌ <b>Connection Error!</b>

━━━━━━━━━━━━━━━━━━━

Could not connect to your MT5 account.

━━━━━━━━━━━━━━━━━━━

<b>Possible reasons:</b>
• MT5 account is not active
• Server connection issue
• Account is blocked/locked

━━━━━━━━━━━━━━━━━━━

Please check your account and try again with /mt5setup.`
    } else if (errorMessage.includes('exists') || errorMessage.includes('already')) {
      userMessage = `❌ <b>Account Already Exists!</b>

━━━━━━━━━━━━━━━━━━━

This MT5 account is already set up for copying.

━━━━━━━━━━━━━━━━━━━

Use /settings to modify your copier settings.`
    } else if (errorMessage.includes('ACCOUNT_LIMIT') || errorMessage.includes('TRIAL')) {
      userMessage = `❌ <b>Account Limit Reached!</b>

━━━━━━━━━━━━━━━━━━━

The primary MetaCopier account has reached its 10 account limit.

✅ <b>Automatically switching to secondary account...</b>

Don't worry, the system has automatically switched to your secondary MetaCopier account.

━━━━━━━━━━━━━━━━━━━

<b>This is normal!</b> When you have many users, the bot automatically uses secondary accounts to handle the load.

Your copier is now active on the secondary account.

━━━━━━━━━━━━━━━━━━━

Use /settings to modify your settings anytime!`
    } else {
      userMessage = `❌ <b>Setup Failed!</b>

━━━━━━━━━━━━━━━━━━━

${errorMessage}

━━━━━━━━━━━━━━━━━━━

Please check your credentials and try again with /mt5setup`
    }

    await sendMessage(user.id, userMessage)
    await clearConversationState(userId)
    return false
  }
}

/**
 * Handle callback queries for MT5 setup flow
 */
async function handleMt5Callback(user: TelegramUser, callbackId: string, data: string, messageId?: number): Promise<void> {
  const userId = user.id.toString()

  // MT5 Setup callbacks
  if (data === 'mt5_confirm') {
    await answerCallbackQuery(callbackId, 'Setting up your copier...')
    await processMt5Setup(user)
  }
  else if (data === 'mt5_cancel' || data === 'mt5_skip') {
    await answerCallbackQuery(callbackId, 'Setup cancelled')
    await clearConversationState(userId)
    await sendMessage(user.id, `❌ Setup cancelled.

You can start anytime with /mt5setup`)
  }
  // Settings callbacks
  else if (data === 'settings_lotsize') {
    const subscription = await prisma.subscription.findFirst({
      where: {
        telegramUserId: userId,
        hasCopierAccess: true,
        isRemoved: false,
        expiresAt: { gte: new Date() }
      },
      include: { mt5Setup: true },
      orderBy: { createdAt: 'desc' }
    })

    if (subscription?.mt5Setup) {
      await answerCallbackQuery(callbackId)
      if (messageId) {
        const currentLotSize = subscription.mt5Setup.lotSize || 0.01
        const maxPositions = subscription.mt5Setup.maxOpenPositions || 10
        const totalExposure = (currentLotSize * maxPositions).toFixed(2)

        await editMessageText(
          user.id,
          messageId,
          `📊 <b>Select Your Lot Size</b>

━━━━━━━━━━━━━━━━━━━

<b>This is the lot size you want to copy:</b>

When master opens a trade, your account will copy it with this lot size.

━━━━━━━━━━━━━━━━━━━

<b>Examples:</b>

• <b>0.01</b> - Copy same size as master (safe) ✅
• <b>0.02</b> - Double the master's size (more profit, more risk) 📈
• <b>0.03</b> - Triple the master's size (higher risk) 🚀

━━━━━━━━━━━━━━━━━━━

<b>Your Current Settings:</b>

📊 Lot Size: <b>${currentLotSize}</b>
🔢 Max Positions: <b>${maxPositions}</b>
📊 <b>Total Exposure: ${totalExposure} lots</b>

<i>"If all ${maxPositions} trades open at once"</i>

━━━━━━━━━━━━━━━━━━━

<b>Current: ${currentLotSize}</b>

━━━━━━━━━━━━━━━━━━━

Select a new lot size:`,
          lotSizeKeyboard(currentLotSize)
        )
      }
    }
  }
  else if (data.startsWith('lotsize_')) {
    const value = parseFloat(data.split('_')[1])
    // Calculate multiplier: if user wants 0.02 lots and master uses 0.01, multiplier is 2.0
    const calculatedMultiplier = value / 0.01
    await answerCallbackQuery(callbackId, `Lot size set to ${value} lots`)

    const subscription = await prisma.subscription.findFirst({
      where: {
        telegramUserId: userId,
        hasCopierAccess: true,
        isRemoved: false,
        expiresAt: { gte: new Date() }
      },
      include: { mt5Setup: true },
      orderBy: { createdAt: 'desc' }
    })

    if (subscription?.mt5Setup && messageId) {
      // Store pending change - we store lotSize, but will calculate multiplier when saving
      const current = pendingSettingsChanges.get(userId) || {}
      pendingSettingsChanges.set(userId, { ...current, lotSize: value })

      const maxPositions = subscription.mt5Setup.maxOpenPositions || 10
      const totalExposure = (value * maxPositions).toFixed(2)

      // Update in-memory state (not saved until user clicks Save)
      await editMessageText(
        user.id,
        messageId,
        `📊 <b>Select Your Lot Size</b>

━━━━━━━━━━━━━━━━━━━

<b>Selected: ${value} lots</b>

━━━━━━━━━━━━━━━━━━━

<b>📊 What This Means:</b>

When master opens 0.01 lots, you'll open ${value} lots.

━━━━━━━━━━━━━━━━━━━

<b>Your Total Exposure:</b>

📊 Lot Size: <b>${value}</b>
🔢 Max Positions: <b>${maxPositions}</b>
📊 <b>Total: ${totalExposure} lots</b>

<i>"If all ${maxPositions} trades open at once"</i>

━━━━━━━━━━━━━━━━━━━

<b>Risk Warning:</b>

Higher total exposure = Higher risk!
Make sure you can handle ${totalExposure} lots total.

━━━━━━━━━━━━━━━━━━━

Click Save to apply changes.`,
        lotSizeKeyboard(value)
      )
    }
  }
  else if (data === 'settings_maxlot') {
    const subscription = await prisma.subscription.findFirst({
      where: {
        telegramUserId: userId,
        hasCopierAccess: true,
        isRemoved: false,
        expiresAt: { gte: new Date() }
      },
      include: { mt5Setup: true },
      orderBy: { createdAt: 'desc' }
    })

    if (subscription?.mt5Setup) {
      await answerCallbackQuery(callbackId)
      if (messageId) {
        await editMessageText(
          user.id,
          messageId,
          `📏 <b>Max Lot Per Trade</b>

━━━━━━━━━━━━━━━━━━━

<b>What is Max Lot Per Trade?</b>

This limits the size of EACH individual trade copied.

━━━━━━━━━━━━━━━━━━━

<b>Examples (with 1.0x multiplier):</b>

<i>If master opens 0.01 lots:</i>
• Max 0.01 → Copies 0.01 ✅
• Max 0.05 → Copies 0.01 ✅

<i>If master opens 0.10 lots:</i>
• Max 0.01 → Copies 0.01 📉
• Max 0.05 → Copies 0.05 📏
• Max 0.10 → Copies 0.10 ✅

━━━━━━━━━━━━━━━━━━━

<b>Current: ${subscription.mt5Setup.maxLotSize}</b>

━━━━━━━━━━━━━━━━━━━

Select a new limit:`,
          maxLotKeyboard(subscription.mt5Setup.maxLotSize)
        )
      }
    }
  }
  else if (data.startsWith('maxlot_')) {
    const value = parseFloat(data.split('_')[1])
    await answerCallbackQuery(callbackId, `Max lot per trade set to ${value}`)

    const subscription = await prisma.subscription.findFirst({
      where: {
        telegramUserId: userId,
        hasCopierAccess: true,
        isRemoved: false,
        expiresAt: { gte: new Date() }
      },
      include: { mt5Setup: true },
      orderBy: { createdAt: 'desc' }
    })

    if (subscription?.mt5Setup && messageId) {
      // Store pending change
      const current = pendingSettingsChanges.get(userId) || {}
      pendingSettingsChanges.set(userId, { ...current, maxLotSize: value })

      await editMessageText(
        user.id,
        messageId,
        `📏 <b>Max Lot Per Trade</b>

━━━━━━━━━━━━━━━━━━━

<b>Selected: ${value}</b>

━━━━━━━━━━━━━━━━━━━

Click Save to apply changes.`,
        maxLotKeyboard(value)
      )
    }
  }
  else if (data === 'settings_maxlot_total') {
    const subscription = await prisma.subscription.findFirst({
      where: {
        telegramUserId: userId,
        hasCopierAccess: true,
        isRemoved: false,
        expiresAt: { gte: new Date() }
      },
      include: { mt5Setup: true },
      orderBy: { createdAt: 'desc' }
    })

    if (subscription?.mt5Setup) {
      await answerCallbackQuery(callbackId)
      if (messageId) {
        await editMessageText(
          user.id,
          messageId,
          `📊 <b>Max Total Exposure</b>

━━━━━━━━━━━━━━━━━━━

<b>What is Max Total Exposure?</b>

This is the MAXIMUM TOTAL lots you can have across ALL open trades combined.

━━━━━━━━━━━━━━━━━━━

<b>Examples:</b>

<i>If you have 10 open trades:</i>
• Max 0.1 → Each trade = 0.01 lots
• Max 0.5 → Each trade = 0.05 lots
• Max 1.0 → Each trade = 0.10 lots

━━━━━━━━━━━━━━━━━━━

<b>💡 Risk Management:</b>

Lower total exposure = Lower risk but less profit potential
Higher total exposure = Higher risk but more profit potential

━━━━━━━━━━━━━━━━━━━

<b>Current: ${subscription.mt5Setup.maximumLot || 0.2}</b>

━━━━━━━━━━━━━━━━━━━

Select a new limit:`,
          maxLotTotalKeyboard(subscription.mt5Setup.maximumLot || 0.2)
        )
      }
    }
  }
  else if (data.startsWith('maxlot_total_')) {
    const value = parseFloat(data.split('_')[2])
    await answerCallbackQuery(callbackId, `Max total exposure set to ${value}`)

    const subscription = await prisma.subscription.findFirst({
      where: {
        telegramUserId: userId,
        hasCopierAccess: true,
        isRemoved: false,
        expiresAt: { gte: new Date() }
      },
      include: { mt5Setup: true },
      orderBy: { createdAt: 'desc' }
    })

    if (subscription?.mt5Setup && messageId) {
      // Store pending change
      const current = pendingSettingsChanges.get(userId) || {}
      pendingSettingsChanges.set(userId, { ...current, maximumLot: value })

      await editMessageText(
        user.id,
        messageId,
        `📊 <b>Max Total Exposure</b>

━━━━━━━━━━━━━━━━━━━

<b>Selected: ${value}</b>

━━━━━━━━━━━━━━━━━━━

Click Save to apply changes.`,
        maxLotTotalKeyboard(value)
      )
    }
  }
  else if (data === 'settings_maxpositions') {
    const subscription = await prisma.subscription.findFirst({
      where: {
        telegramUserId: userId,
        hasCopierAccess: true,
        isRemoved: false,
        expiresAt: { gte: new Date() }
      },
      include: { mt5Setup: true },
      orderBy: { createdAt: 'desc' }
    })

    if (subscription?.mt5Setup) {
      await answerCallbackQuery(callbackId)
      if (messageId) {
        await editMessageText(
          user.id,
          messageId,
          `🔢 <b>Max Open Positions</b>

━━━━━━━━━━━━━━━━━━━

<b>What is Max Open Positions?</b>

This is the maximum NUMBER of trades you can have open at the same time.

━━━━━━━━━━━━━━━━━━━

<b>Examples:</b>

Max 3 positions:
• You can copy up to 3 trades at once
• 4th trade won't be copied until one closes

Max 10 positions:
• You can copy up to 10 trades at once
• Good for active trading strategies

━━━━━━━━━━━━━━━━━━━

<b>Current: ${subscription.mt5Setup.maxOpenPositions}</b>

━━━━━━━━━━━━━━━━━━━

Select a new limit:`,
          maxPositionsKeyboard(subscription.mt5Setup.maxOpenPositions)
        )
      }
    }
  }
  else if (data.startsWith('maxpositions_')) {
    const value = parseInt(data.split('_')[1])
    await answerCallbackQuery(callbackId, `Max positions set to ${value}`)

    const subscription = await prisma.subscription.findFirst({
      where: {
        telegramUserId: userId,
        hasCopierAccess: true,
        isRemoved: false,
        expiresAt: { gte: new Date() }
      },
      include: { mt5Setup: true },
      orderBy: { createdAt: 'desc' }
    })

    if (subscription?.mt5Setup && messageId) {
      // Store pending change
      const current = pendingSettingsChanges.get(userId) || {}
      pendingSettingsChanges.set(userId, { ...current, maxOpenPositions: value })

      await editMessageText(
        user.id,
        messageId,
        `🔢 <b>Max Open Positions</b>

━━━━━━━━━━━━━━━━━━━

<b>Selected: ${value}</b>

━━━━━━━━━━━━━━━━━━━

Click Save to apply changes.`,
        maxPositionsKeyboard(value)
      )
    }
  }
  else if (data === 'settings_tp2') {
    const userId = user.id.toString()
    const subscription = await prisma.subscription.findFirst({
      where: {
        telegramUserId: userId,
        hasCopierAccess: true,
        isRemoved: false,
        expiresAt: { gte: new Date() }
      },
      include: { mt5Setup: true },
      orderBy: { createdAt: 'desc' }
    })

    if (subscription?.mt5Setup && messageId) {
      // Toggle TP2 preference
      const current = pendingSettingsChanges.get(userId) || {}
      const newVal = current.tp2Enabled !== undefined ? !current.tp2Enabled : !subscription.mt5Setup.tp2Enabled

      // When TP2 is disabled, we force maxOpenPositions to 8 (TP1 Only)
      // When TP2 is enabled, we force it back to 10 (Default)
      pendingSettingsChanges.set(userId, {
        ...current,
        tp2Enabled: newVal,
        maxOpenPositions: newVal ? 10 : 8
      })

      await answerCallbackQuery(callbackId, `TP2 Trades ${newVal ? 'ENABLED' : 'DISABLED'}`)

      // Refresh menu
      await editMessageText(
        user.id,
        messageId,
        `⚙️ <b>Copier Settings</b> (Unsaved)
        
━━━━━━━━━━━━━━━━━━━

Configure your trade copying settings:

━━━━━━━━━━━━━━━━━━━`,
        settingsKeyboard({
          copierMultiplier: subscription.mt5Setup.copierMultiplier,
          lotSize: current.lotSize ?? (subscription.mt5Setup.lotSize || 0.01),
          maxLotSize: current.maxLotSize ?? subscription.mt5Setup.maxLotSize,
          maximumLot: current.maximumLot ?? (subscription.mt5Setup.maximumLot || 0.2),
          maxOpenPositions: newVal ? 10 : 8,
          copyStopLoss: current.copyStopLoss ?? subscription.mt5Setup.copyStopLoss,
          copyTakeProfit: current.copyTakeProfit ?? subscription.mt5Setup.copyTakeProfit,
          tp2Enabled: newVal
        })
      )
    }
  }
  else if (data === 'settings_save') {
    // Get pending settings
    const pending = pendingSettingsChanges.get(userId)

    if (!pending || Object.keys(pending).length === 0) {
      await answerCallbackQuery(callbackId, 'No changes to save')
      await sendMessage(user.id, `ℹ️ No changes to save.

Use /settings to modify your copier settings.`)
      return
    }

    try {
      // Get user's subscription and MT5 setup
      const subscription = await prisma.subscription.findFirst({
        where: {
          telegramUserId: userId,
          hasCopierAccess: true,
          isRemoved: false,
          expiresAt: { gte: new Date() }
        },
        include: { mt5Setup: true },
        orderBy: { createdAt: 'desc' }
      })

      if (!subscription?.mt5Setup || !subscription.mt5Setup.metacopierAccountId || !subscription.mt5Setup.metacopierCopierId) {
        await answerCallbackQuery(callbackId, '❌ No copier found')
        await sendMessage(user.id, `❌ No active copier found.

Please complete MT5 setup first with /mt5setup`)
        pendingSettingsChanges.delete(userId)
        return
      }

      await answerCallbackQuery(callbackId, 'Saving settings...')

      // Calculate multiplier from lotSize if lotSize was changed
      // Master uses 0.01 lot size, so multiplier = userLotSize / 0.01
      const calculatedMultiplier = pending.lotSize !== undefined
        ? pending.lotSize / 0.01
        : subscription.mt5Setup.copierMultiplier

      // Build update params with current values + pending changes
      const updateParams = {
        accountId: subscription.mt5Setup.metacopierAccountId,
        copierId: subscription.mt5Setup.metacopierCopierId,
        multiplier: calculatedMultiplier,
        maxLotSize: pending.maxLotSize ?? subscription.mt5Setup.maxLotSize,
        maximumLot: pending.maximumLot ?? subscription.mt5Setup.maximumLot,
        maxOpenPositions: pending.maxOpenPositions ?? subscription.mt5Setup.maxOpenPositions,
        copyStopLoss: pending.copyStopLoss ?? subscription.mt5Setup.copyStopLoss,
        copyTakeProfit: pending.copyTakeProfit ?? subscription.mt5Setup.copyTakeProfit,
        metacopierAccountIndex: subscription.mt5Setup.metacopierAccountIndex ?? 0
      }

      // Update MetaCopier
      await updateCopierSettings(updateParams)

      // Update database
      await prisma.mt5Setup.update({
        where: { id: subscription.mt5Setup.id },
        data: {
          lotSize: pending.lotSize ?? subscription.mt5Setup.lotSize,
          copierMultiplier: calculatedMultiplier,
          maxLotSize: updateParams.maxLotSize,
          maximumLot: updateParams.maximumLot,
          maxOpenPositions: updateParams.maxOpenPositions,
          copyStopLoss: updateParams.copyStopLoss,
          copyTakeProfit: updateParams.copyTakeProfit,
          tp2Enabled: pending.tp2Enabled ?? subscription.mt5Setup.tp2Enabled
        }
      })

      // Clear pending settings
      pendingSettingsChanges.delete(userId)

      await sendMessage(user.id, `✅ <b>Settings Saved Successfully!</b>

━━━━━━━━━━━━━━━━━━━

<b>Your copier settings have been updated:</b>

${pending.lotSize !== undefined ? `📊 Lot Size: ${pending.lotSize} lots\n` : ''}
${pending.maxLotSize !== undefined ? `📏 Max Lot Per Trade: ${updateParams.maxLotSize}\n` : ''}
${pending.maximumLot !== undefined ? `📊 Max Total Exposure: ${updateParams.maximumLot}\n` : ''}
${pending.maxOpenPositions !== undefined ? `🔢 Max Positions: ${updateParams.maxOpenPositions}\n` : ''}
${pending.tp2Enabled !== undefined ? `🚀 TP2 Trades: ${pending.tp2Enabled ? 'ENABLED ✅' : 'DISABLED ❌'}\n` : ''}

━━━━━━━━━━━━━━━━━━━

Changes are now active on your MT5 account!

Use /settings to modify anytime.`)

    } catch (error) {
      console.error('Error saving settings:', error)
      await answerCallbackQuery(callbackId, '❌ Failed to save')
      await sendMessage(user.id, `❌ Failed to save settings!

Please try again or contact support if the problem persists.`)
    }
  }
  else if (data === 'settings_cancel') {
    // Clear pending settings when canceling
    pendingSettingsChanges.delete(userId)
    await answerCallbackQuery(callbackId)
    await handleSettings(user)
  }
  else if (data === 'settings_back') {
    // Don't clear pending settings when going back - just show the menu
    await answerCallbackQuery(callbackId)
    await handleSettings(user)
  }
}

/**
 * POST handler for Telegram webhook
 */
export async function POST(request: NextRequest) {
  try {
    const body: TelegramUpdate = await request.json()

    // Handle callback queries (button clicks)
    if (body.callback_query) {
      const { callback_query } = body
      const { id, from, data, message } = callback_query
      const userId = from.id.toString()

      console.log('Received callback query:', data, 'from user:', userId)

      // Auto-register/update user in the User table
      try {
        await prisma.user.upsert({
          where: { telegramUserId: userId },
          update: {
            telegramUsername: from.username || null,
            telegramName: from.first_name || null,
          },
          create: {
            telegramUserId: userId,
            telegramUsername: from.username || null,
            telegramName: from.first_name || null,
          }
        })
      } catch (err) {
        console.error('[User Tracking] Failed to upsert user from callback:', err)
      }

      // Handle MT5 setup and settings callbacks first
      if (data.startsWith('mt5_') || data.startsWith('settings_') || data.startsWith('lotsize_') || data.startsWith('maxlot_') || data.startsWith('maxpositions_')) {
        await handleMt5Callback(from, id, data, message?.message_id)
        return NextResponse.json({ ok: true })
      }

      // Answer the callback query to remove the loading state - use context-appropriate text
      const isVerifyCallback = data === 'verify_basic' || data === 'verify_biweekly' || data === 'verify_monthly' || data === 'verify_promo' || data === 'verify_premium' || data === 'verify_copier24hr'

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: id,
          ...(isVerifyCallback ? { text: '✅ Please send your transaction reference' } : {})
        })
      })

      // Handle verify payment button clicks
      if (data === 'verify_basic' || data === 'verify_biweekly' || data === 'verify_monthly' || data === 'verify_promo' || data === 'verify_premium' || data === 'verify_copier24hr') {
        const planType: PlanType = data === 'verify_basic' ? 'basic' : data === 'verify_biweekly' ? 'biweekly' : data === 'verify_monthly' ? 'monthly' : data === 'verify_promo' ? 'promo' : data === 'verify_copier24hr' ? 'copier24hr' : 'premium'

        // Mark user as waiting for reference
        pendingVerificationUsers.set(userId, planType)

        // Send photo with instructions
        const planNames = {
          basic: 'Basic (₦5,000)',
          biweekly: 'Bi-Weekly (₦10,000)',
          monthly: 'Monthly (₦15,000)',
          promo: 'Promo (₦3,000)',
          premium: 'Premium (₦22,000)',
          copier24hr: 'Copier 24Hr Promo (₦15,000)'
        }
        const planName = planNames[planType]
        const caption = `✅ <b>Verifying ${planName} Payment</b>

━━━━━━━━━━━━━━━━━━━

<b>⚠️ IMPORTANT:</b>
<i>ONLY paste the reference code below!</i>

<i>The reference is just letters and numbers (no spaces, no "REF:" prefix)</i>

━━━━━━━━━━━━━━━━━━━

Look at the image above 👆 to see where to find your reference in the Paystack email.

━━━━━━━━━━━━━━━━━━━

❌ Don't send: /verify_${planType} REF123
❌ Don't send: REF: iby0ro0awd
✅ Just send: iby0ro0awd

━━━━━━━━━━━━━━━━━━━

Just paste the reference number below and I'll verify instantly!

Or send /cancel to exit.`

        await sendPhoto(from.id, REFERENCE_IMAGE_ID, caption)

        return NextResponse.json({ ok: true })
      }

      // Handle pay button clicks from inline keyboards
      if (data === 'start_trial' || data === 'trial') {
        await handleTrial(from)
        return NextResponse.json({ ok: true })
      }

      if (data === 'pay') {
        await handlePay(from)
        return NextResponse.json({ ok: true })
      }

      if (data === 'pay_promo' || data === 'promo') {
        await handlePromoPay(from)
        return NextResponse.json({ ok: true })
      }

      if (data === 'promo_copier_24hr') {
        await handleCopierPromoPay(from)
        return NextResponse.json({ ok: true })
      }

      if (data === 'status') {
        await handleStatus(from)
        return NextResponse.json({ ok: true })
      }

      if (data === 'help') {
        await handleHelp(from)
        return NextResponse.json({ ok: true })
      }

      return NextResponse.json({ ok: true })
    }

    if (!body.message || !body.message.text) {
      return NextResponse.json({ ok: true })
    }

    const { message } = body
    const { from, chat, text } = message

    // Parse command and arguments
    const parts = text!.trim().split(/\s+/)
    const command = parts[0].toLowerCase()
    const args = parts.slice(1)

    const userId = from.id.toString()

    // Handle Deep Linking (start parameter)
    // Telegram sends t.me/bot?start=payload as "/start payload"
    if (command === '/start' && args.length > 0) {
      const payload = args[0]
      console.log(`[DeepLink] Received payload: ${payload}`)

      // Handle clean command mapping (e.g., promo_VIP -> /promo VIP)
      if (payload.includes('_')) {
        const [targetCmd, ...cmdArgs] = payload.split('_')
        const newCommand = `/${targetCmd}`

        // Only re-map if it's a known command to avoid hijacking /start
        const knownCommands = ['/promo', '/pay', '/verify', '/checkuser', '/status', '/help']
        if (knownCommands.includes(newCommand)) {
          console.log(`[DeepLink] Re-routing /start ${payload} to ${newCommand} ${cmdArgs.join(' ')}`)
          // We don't want to lose the user registration, but we skip handleStart
          // We'll update the command and args variables for the switch block below
          // Update local variables (re-declared as let in the target content or adjusted)
          // Actually, we can just replace the logic here:
          await (async () => {
            // Re-run registration just in case
            try {
              await prisma.user.upsert({
                where: { telegramUserId: userId },
                update: {
                  telegramUsername: from.username || null,
                  telegramName: from.first_name || null,
                },
                create: {
                  telegramUserId: userId,
                  telegramUsername: from.username || null,
                  telegramName: from.first_name || null,
                }
              })
            } catch (err) {
              console.error('[User Tracking] Failed to upsert user from deep link:', err)
            }

            // Route to target command
            switch (newCommand) {
              case '/promo':
                await handlePromo(from, cmdArgs)
                break
              case '/pay':
                await handlePay(from)
                break
              case '/status':
                await handleStatus(from)
                break
              case '/help':
                await handleHelp(from)
                break
              case 'start_trial':
                await handleTrial(from)
                break
              default:
                // If not specifically handled here, let it fall through to normal switch
                // with the new command/args if we were to modify them.
                // For safety, we just call handleStart if no specific mapping
                await handleStart(from)
            }
          })()
          return NextResponse.json({ ok: true })
        }
      } else if (payload === 'help') {
        await handleHelp(from)
        return NextResponse.json({ ok: true })
      } else if (payload === 'status') {
        await handleStatus(from)
        return NextResponse.json({ ok: true })
      }
    }

    // Auto-register/update user in the User table
    try {
      await prisma.user.upsert({
        where: { telegramUserId: userId },
        update: {
          telegramUsername: from.username || null,
          telegramName: from.first_name || null,
        },
        create: {
          telegramUserId: userId,
          telegramUsername: from.username || null,
          telegramName: from.first_name || null,
        }
      })
    } catch (err) {
      console.error('[User Tracking] Failed to upsert user from message:', err)
    }

    // Check if user is waiting for verification reference
    if (pendingVerificationUsers.has(userId) && !command.startsWith('/')) {
      // User is providing their transaction reference
      const reference = text!.trim()
      const planType = pendingVerificationUsers.get(userId)!

      // Remove from pending list
      pendingVerificationUsers.delete(userId)

      // Verify the payment
      await handleVerify(from, reference, planType)
      return NextResponse.json({ ok: true })
    }

    // Check if user is waiting for promo email input
    if (pendingPromoEmailUsers.has(userId) && !command.startsWith('/')) {
      const email = text!.trim()

      if (!isValidEmail(email)) {
        await sendMessage(from.id, `❌ <b>Invalid email format</b>\n\nPlease enter a valid email address.\n\n<i>Type your email again or send /cancel to exit</i>`)
        return NextResponse.json({ ok: true })
      }

      await showPromoPaymentButton(from, email)
      return NextResponse.json({ ok: true })
    }

    // Check if user is waiting for copier 24hr promo email input
    if (pendingCopierPromoEmailUsers.has(userId) && !command.startsWith('/')) {
      const email = text!.trim()

      if (!isValidEmail(email)) {
        await sendMessage(from.id, `❌ <b>Invalid email format</b>\n\nPlease enter a valid email address.\n\n<i>Type your email again or send /cancel to exit</i>`)
        return NextResponse.json({ ok: true })
      }

      await showCopierPromoPaymentButton(from, email)
      return NextResponse.json({ ok: true })
    }

    // Check if user is waiting for email input
    if (pendingEmailUsers.has(userId) && !command.startsWith('/')) {
      // User is providing their email
      const email = text!.trim()

      if (!isValidEmail(email)) {
        await sendMessage(from.id, `❌ <b>Invalid email format</b>

Please enter a valid email address.

<b>Examples:</b>
✅ john@email.com
✅ mary.smith@gmail.com
❌ john
❌ john@
❌ @email.com

<i>Type your email again or send /cancel to exit</i>`)
        return NextResponse.json({ ok: true })
      }

      // Show payment buttons with the email
      await showPaymentButtons(from, email)
      return NextResponse.json({ ok: true })
    }

    // Check if user is in conversation flow (MT5 setup or promo creation)
    const conversationState = await getConversationState(userId)
    if (conversationState && !command.startsWith('/')) {
      // Check if it's a promo conversation step
      const promoSteps = ['promo_code', 'promo_name', 'plan_type', 'duration', 'is_free', 'has_copier', 'amount', 'expiry']
      try {
        if (promoSteps.includes(conversationState.step)) {
          console.log('[Webhook] Calling handlePromoConversation for step:', conversationState.step)
          await handlePromoConversation(from, text!)
        } else {
          await handleMt5Conversation(from, text!)
        }
      } catch (error) {
        console.error('[Webhook] Error in conversation handler:', error)
        await sendMessage(from.id, 'Something went wrong. Please try again.')
      }
      return NextResponse.json({ ok: true })
    }

    // Handle commands
    switch (command) {
      case '/start':
        await handleStart(from)
        break

      case '/help':
        await handleHelp(from)
        break

      case '/pay':
        await handlePay(from)
        break

      case '/trial':
        await handleTrial(from)
        break

      case '/cancel':
        if (pendingEmailUsers.has(userId)) {
          pendingEmailUsers.delete(userId)
          await sendMessage(from.id, '✅ Cancelled. Send /pay when you\'re ready to get payment links.')
        } else if (pendingPromoEmailUsers.has(userId)) {
          pendingPromoEmailUsers.delete(userId)
          await sendMessage(from.id, '✅ Cancelled. Send /pay when you\'re ready to get payment links.')
        } else if (pendingCopierPromoEmailUsers.has(userId)) {
          pendingCopierPromoEmailUsers.delete(userId)
          await sendMessage(from.id, '✅ Cancelled. Send /pay when you\'re ready to get payment links.')
        } else if (pendingVerificationUsers.has(userId)) {
          pendingVerificationUsers.delete(userId)
          await sendMessage(from.id, '✅ Verification cancelled. Send /pay to start over.')
        } else {
          await sendMessage(from.id, 'Nothing to cancel. Send /pay to get started.')
        }
        break

      case '/verify_basic':
        // If no reference provided, show instructions
        if (!args[0]) {
          pendingVerificationUsers.set(userId, 'basic')

          const caption = `✅ <b>Verifying Basic (₦5,000) Payment</b>

━━━━━━━━━━━━━━━━━━━

<b>⚠️ IMPORTANT:</b>
<i>ONLY paste the reference code below!</i>

<i>The reference is just letters and numbers (no spaces, no "REF:" prefix)</i>

━━━━━━━━━━━━━━━━━━━

Look at the image above 👆 to see where to find your reference in the Paystack email.

━━━━━━━━━━━━━━━━━━━

❌ Don't send: /verify_basic REF123
❌ Don't send: REF: iby0ro0awd
✅ Just send: iby0ro0awd

━━━━━━━━━━━━━━━━━━━

Just paste the reference number below and I'll verify instantly!

Or send /cancel to exit.`

          await sendPhoto(from.id, REFERENCE_IMAGE_ID, caption)
        } else {
          await handleVerifyBasic(from, args[0])
        }
        break

      case '/verify_biweekly':
        // If no reference provided, show instructions
        if (!args[0]) {
          pendingVerificationUsers.set(userId, 'biweekly')

          const caption = `✅ <b>Verifying Bi-Weekly (₦10,000) Payment</b>

━━━━━━━━━━━━━━━━━━━

<b>⚠️ IMPORTANT:</b>
<i>ONLY paste the reference code below!</i>

<i>The reference is just letters and numbers (no spaces, no "REF:" prefix)</i>

━━━━━━━━━━━━━━━━━━━

Look at the image above 👆 to see where to find your reference in the Paystack email.

━━━━━━━━━━━━━━━━━━━

❌ Don't send: /verify_biweekly REF123
❌ Don't send: REF: iby0ro0awd
✅ Just send: iby0ro0awd

━━━━━━━━━━━━━━━━━━━

Just paste the reference number below and I'll verify instantly!

Or send /cancel to exit.`

          await sendPhoto(from.id, REFERENCE_IMAGE_ID, caption)
        } else {
          await handleVerifyBiweekly(from, args[0])
        }
        break

      case '/verify_monthly':
        // If no reference provided, show instructions
        if (!args[0]) {
          pendingVerificationUsers.set(userId, 'monthly')

          const caption = `✅ <b>Verifying Monthly (₦15,000) Payment</b>

━━━━━━━━━━━━━━━━━━━

<b>⚠️ IMPORTANT:</b>
<i>ONLY paste the reference code below!</i>

<i>The reference is just letters and numbers (no spaces, no "REF:" prefix)</i>

━━━━━━━━━━━━━━━━━━━

Look at the image above 👆 to see where to find your reference in the Paystack email.

━━━━━━━━━━━━━━━━━━━

❌ Don't send: /verify_monthly REF123
❌ Don't send: REF: iby0ro0awd
✅ Just send: iby0ro0awd

━━━━━━━━━━━━━━━━━━━

Just paste the reference number below and I'll verify instantly!

Or send /cancel to exit.`

          await sendPhoto(from.id, REFERENCE_IMAGE_ID, caption)
        } else {
          await handleVerifyMonthly(from, args[0])
        }
        break

      case '/verify_promo':
        // If no reference provided, show instructions
        if (!args[0]) {
          pendingVerificationUsers.set(userId, 'promo')

          const caption = `✅ <b>Verifying Promo (₦3,000) Payment</b>

━━━━━━━━━━━━━━━━━━━

<b>⚠️ IMPORTANT:</b>
<i>ONLY paste the reference code below!</i>

<i>The reference is just letters and numbers (no spaces, no "REF:" prefix)</i>

━━━━━━━━━━━━━━━━━━━

Look at the image above 👆 to see where to find your reference in the Paystack email.

━━━━━━━━━━━━━━━━━━━

❌ Don't send: /verify_promo REF123
❌ Don't send: REF: iby0ro0awd
✅ Just send: iby0ro0awd

━━━━━━━━━━━━━━━━━━━

Each payment link works ONCE only!
Wait for next broadcast for fresh links.

Just paste the reference number below and I'll verify instantly!

Or send /cancel to exit.`

          await sendPhoto(from.id, REFERENCE_IMAGE_ID, caption)
        } else {
          await handleVerifyPromo(from, args[0])
        }
        break

      case '/promo':
        await handlePromo(from, args)
        break

      case '/verify_premium':
        // If no reference provided, show instructions
        if (!args[0]) {
          pendingVerificationUsers.set(userId, 'premium')

          const caption = `✅ <b>Verifying Premium (₦22,000) Payment</b>

━━━━━━━━━━━━━━━━━━━

<b>⚠️ IMPORTANT:</b>
<i>ONLY paste the reference code below!</i>

<i>The reference is just letters and numbers (no spaces, no "REF:" prefix)</i>

━━━━━━━━━━━━━━━━━━━

Look at the image above 👆 to see where to find your reference in the Paystack email.

━━━━━━━━━━━━━━━━━━━

❌ Don't send: /verify_premium REF123
❌ Don't send: REF: iby0ro0awd
✅ Just send: iby0ro0awd

━━━━━━━━━━━━━━━━━━━

Just paste the reference number below and I'll verify instantly!

Or send /cancel to exit.`

          await sendPhoto(from.id, REFERENCE_IMAGE_ID, caption)
        } else {
          await handleVerifyPremium(from, args[0])
        }
        break

      case '/broadcast':
        await handleBroadcast(from, args)
        break

      case '/botstats':
        await handleBotStats(from)
        break

      case '/checkuser':
        await handleCheckUser(from, args)
        break

      case '/broadcast_active':
        await handleBroadcastActive(from, args)
        break

      case '/broadcast_premium':
        await handleBroadcastPremium(from, args)
        break

      case '/broadcast_promo':
        await handleBroadcastPromo(from)
        break

      case '/create_promo':
        await handleCreatePromo(from)
        break

      case '/list_promos':
        await handleListPromos(from)
        break

      case '/broadcast_copier_promo':
        await handleCopierPromoBroadcast(from)
        break

      case '/test_copier_promo':
        await handleTestCopierPromoBroadcast(from)
        break

      case '/delete_promo':
        await handleDeletePromo(from, args)
        break

      case '/status':
        await handleStatus(from)
        break

      case '/mt5setup':
        await handleMt5Setup(from)
        break

      case '/settings':
        await handleSettings(from)
        break

      case '/mystats':
        await handleMyStats(from)
        break

      case '/skip':
        // Skip MT5 setup
        const skipState = await getConversationState(userId)
        if (skipState) {
          await clearConversationState(userId)
          await sendMessage(from.id, `✅ Setup skipped.

You can start MT5 setup anytime by typing /mt5setup`)
        } else {
          await sendMessage(from.id, `Nothing to skip. Type /help to see available commands.`)
        }
        break

      case '/remove_copier':
        await handleRemoveCopier(from)
        break

      default:
        await handleUnknown(from)
        break
    }

    // Always return 200 to Telegram to prevent retries
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error in Telegram webhook:', error)

    // Always return 200 even on errors
    return NextResponse.json({ ok: true })
  }
}

// Allow GET requests for webhook testing
export async function GET(request: NextRequest) {
  return NextResponse.json({ status: 'Telegram webhook is running' })
}
