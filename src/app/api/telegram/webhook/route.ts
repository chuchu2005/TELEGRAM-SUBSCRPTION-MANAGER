import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMessage, sendPhoto, createInviteLink, formatDate, getDaysRemaining, unbanChatMember, sendMessageWithKeyboard, answerCallbackQuery, editMessageText } from '@/lib/telegram'
import { verifyTransaction, validatePaymentAmount, validatePaymentChannel, formatAmount } from '@/lib/paystack'
import { PLANS, PlanType, BANK_DETAILS, CHANNEL_NAME, RATE_LIMIT, calculateExpiryDate, ADMIN_ID } from '@/lib/config'
import { createMt5Account, updateCopierSettings } from '@/lib/metacopier'
import { encryptPassword, decryptPassword } from '@/lib/encryption'
import { setConversationState, getConversationState, clearConversationState, advanceMt5SetupStep, updateConversationData, Mt5SetupStep } from '@/lib/conversation-state'
import { settingsKeyboard, confirmSetupKeyboard, lotSizeKeyboard, maxLotKeyboard, maxLotTotalKeyboard, maxPositionsKeyboard } from '@/lib/telegram-keyboards'
import type { TelegramUpdate, TelegramUser } from '@/lib/telegram'

// Telegram file_id for reference.jpg image
const REFERENCE_IMAGE_ID = 'AgACAgQAAxkDAAN-aZS9NIk99_R4Hg0KxzLGvWke2gQAAvoNaxvqeqBQze2qOwiAklEBAAMCAAN5AAM6BA'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!

// In-memory rate limiting store (consider using Redis for production)
const rateLimitStore = new Map<string, { count: number; blockedUntil: number }>()

// Store users waiting for email input
const pendingEmailUsers = new Set<string>()

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
  const message = `👋 <b>Welcome to ${CHANNEL_NAME}</b>

Choose a plan to get instant access to our VIP community:

💎 <b>Basic Plan</b> - ₦5,000
├─ <b>7 days</b> access to VIP signals
├─ You copy trades manually
└─ Perfect for trying out

📊 <b>Bi-Weekly Plan</b> - ₦10,000
├─ <b>14 days</b> access to VIP signals
├─ You copy trades manually
└─ Great balance of price & duration

📅 <b>Monthly Plan</b> - ₦15,000
├─ <b>30 days</b> access to VIP signals
├─ You copy trades manually
└─ Best value for serious traders

👑 <b>Premium Plan - AUTO COPIER</b> - ₦22,000 ⭐
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

  await sendMessage(user.id, message)
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

💎 <b>Basic Plan</b> - ₦5,000
├─ <b>7 days</b> access to VIP signals
├─ You copy trades manually
└─ For trying out

📊 <b>Bi-Weekly Plan</b> - ₦10,000
├─ <b>14 days</b> access to VIP signals
├─ You copy trades manually
└─ Great balance of price & duration

📅 <b>Monthly Plan</b> - ₦15,000
├─ <b>30 days</b> access to VIP signals
├─ You copy trades manually
└─ Best for consistent trading

👑 <b>Premium - AUTO COPIER</b> - ₦22,000 ⭐
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

━━━━━━━━━━━━━━━━━━━

<b>Tap a button below to pay securely:</b>

Payment via bank transfer only

After payment → You'll see your reference
Then send: /verify_basic REFERENCE

💡 Tip: You'll find the reference on the success page after payment

Or send /pay to start over

💎 Pay ₦5,000 (Basic - 7 days)
📊 Pay ₦10,000 (Bi-Weekly - 14 days)
📅 Pay ₦15,000 (Monthly - 30 days)
👑 Pay ₦22,000 (Premium - 14 days + Auto Copier) ⭐

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
              { text: '💎 Pay ₦5,000 (Basic)', url: basicData.authorizationUrl }
            ],
            [
              { text: '✅ Verify Basic Payment', callback_data: 'verify_basic' }
            ],
            [
              { text: '📊 Pay ₦10,000 (Bi-Weekly)', url: biweeklyData.authorizationUrl }
            ],
            [
              { text: '✅ Verify Bi-Weekly Payment', callback_data: 'verify_biweekly' }
            ],
            [
              { text: '📅 Pay ₦15,000 (Monthly)', url: monthlyData.authorizationUrl }
            ],
            [
              { text: '✅ Verify Monthly Payment', callback_data: 'verify_monthly' }
            ],
            [
              { text: '👑 Pay ₦22,000 (Premium)', url: premiumData.authorizationUrl }
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

  // Create FRESH promo payment link for this broadcast
  // Note: User will provide their actual email during payment
  const promoResponse = await fetch(`${APP_URL}/api/payment/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      telegramId: ADMIN_ID.toString(),
      telegramUsername: 'admin',
      planType: 'promo',
      email: 'promo@pearvip.com', // Generic email - user provides theirs during payment
      metadata: {
        broadcastTimestamp: broadcastTimestamp.toString() // Timestamp stored in metadata
      }
    })
  })

  const promoData = await promoResponse.json()

  if (!promoData.success) {
    await sendMessage(user.id, '❌ Failed to generate promo payment link. Please try again.')
    return
  }

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
                { text: '🔥 Get ₦3,000 Promo (7 Days)', url: promoData.authorizationUrl }
              ],
              [
                { text: '✅ Verify Promo Payment', callback_data: 'verify_promo' }
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

<b>Available commands:</b>
/broadcast - Send to everyone
/broadcast_active - Send to active subscribers only
/broadcast_premium - Send to premium users only

<b>Example:</b>
/broadcast 🎉 Special offer this week!`)
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
  const subscriptions = await prisma.subscription.findMany({
    where: whereClause,
    select: {
      telegramUserId: true,
      telegramUsername: true
    },
    distinct: ['telegramUserId']
  })

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
    }

    // Add delay to avoid rate limiting (20 messages per second)
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  // Send summary to admin
  const summary = `✅ <b>Broadcast Complete!</b>

━━━━━━━━━━━━━━━━━━━

📊 <b>Stats:</b>
• Total recipients: ${subscriptions.length}
• ✅ Successful: ${successCount}
• ❌ Failed: ${failedCount}

${failedUsers.length > 0 ? `❌ <b>Failed Users:</b>\n${failedUsers.slice(0, 10).join('\n')}${failedUsers.length > 10 ? `\n... and ${failedUsers.length - 10} more` : ''}` : ''}`

  await sendMessage(user.id, summary)
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
 * Handle payment verification
 */
async function handleVerify(user: TelegramUser, reference: string, planType: PlanType): Promise<void> {
  const userId = user.id.toString()
  const cleanRef = reference.trim()

  // Idempotency check: Don't process the same reference twice
  if (processingReferences.has(cleanRef)) {
    await sendMessage(user.id, `⏳ <b>Already Processing!</b>

━━━━━━━━━━━━━━━━━━━

This reference is currently being verified. Please wait a moment...`)
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
      await sendMessage(user.id, `❌ <b>No Reference Provided!</b>

━━━━━━━━━━━━━━━━━━━

Please paste your transaction reference.

━━━━━━━━━━━━━━━━━━━

<b>What it looks like:</b>
• iby0ro0awd
• tx1k2m3n4v5
• abc123xyz

━━━━━━━━━━━━━━━━━━━

Just paste the reference from your email below!`)
      return
    }

    // Check if reference contains only valid characters
    if (!/^[A-Za-z0-9_.-]+$/.test(cleanRef)) {
      await sendMessage(user.id, `❌ <b>Invalid Reference Format!</b>

━━━━━━━━━━━━━━━━━━━

The reference should only contain letters and numbers.

━━━━━━━━━━━━━━━━━━━

<b>Examples:</b>
• iby0ro0awd ✅
• TXN_abc123 ✅
• REF123456 ✅

❌ REF: iby0ro0awd (don't include "REF:")
❌ /verify_basic REF123 (don't include command)
❌ iby0ro0 awd (no spaces)

━━━━━━━━━━━━━━━━━━━

Please paste the reference again without extra characters!`)
      // Don't record failed attempt - let them try again
      return
    }

    // Check for promo codes (do this before checking if reference is used globally)
    const promoCode = cleanRef.toUpperCase()

    if (promoCode === 'EXTRA') {
      // Check if user already redeemed this promo code
      const existingPromo = await prisma.subscription.findFirst({
        where: {
          telegramUserId: userId,
          paystackRef: { equals: cleanRef, mode: 'insensitive' }
        }
      })

      if (existingPromo) {
        await sendMessage(user.id, `❌ <b>Already Redeemed!</b>

━━━━━━━━━━━━━━━━━━━

You've already used this promo code!

━━━━━━━━━━━━━━━━━━━

💡 Each promo code can only be used once per user.

Type /pay to see our plans!`)
        processingReferences.delete(cleanRef)
        return
      }

      // 1 week free access (Premium plan)
      const days = 7
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + days)

      // Create subscription
      await prisma.subscription.create({
        data: {
          telegramUserId: userId,
          telegramUsername: user.username,
          telegramName: user.first_name,
          paystackRef: cleanRef,
          amountKobo: 0,
          planType: 'premium',
          hasCopierAccess: true,
          startedAt: new Date(),
          expiresAt: expiresAt
        }
      })

      // Create invite link and add to channel
      const inviteLink = await createInviteLink()

      await sendMessage(user.id, `🎉 <b>Promo Code Activated!</b>

━━━━━━━━━━━━━━━━━━━

✅ <b>EXTRA Promo - 1 Week Premium Access!</b>

📅 <b>Expires:</b> ${expiresAt.toLocaleDateString()}

━━━━━━━━━━━━━━━━━━━

🔗 <b>Join Channel:</b>
${inviteLink}

━━━━━━━━━━━━━━━━━━━

⚠️ <b>Important:</b>
• Click the link above to join the VIP channel
• Access valid for 7 days from today
• Enjoy free VIP signals!
• Meta Copier access included!

━━━━━━━━━━━━━━━━━━━

Want to extend? Type /pay to see our plans!`)

      processingReferences.delete(cleanRef)
      return
    }

    if (promoCode === 'EXTRA2') {
      // Check if user already redeemed this promo code
      const existingPromo = await prisma.subscription.findFirst({
        where: {
          telegramUserId: userId,
          paystackRef: { equals: cleanRef, mode: 'insensitive' }
        }
      })

      if (existingPromo) {
        await sendMessage(user.id, `❌ <b>Already Redeemed!</b>

━━━━━━━━━━━━━━━━━━━

You've already used this promo code!

━━━━━━━━━━━━━━━━━━━

💡 Each promo code can only be used once per user.

Type /pay to see our plans!`)
        processingReferences.delete(cleanRef)
        return
      }

      // 2 weeks free access (Premium plan)
      const days = 14
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + days)

      // Create subscription
      await prisma.subscription.create({
        data: {
          telegramUserId: userId,
          telegramUsername: user.username,
          telegramName: user.first_name,
          paystackRef: cleanRef,
          amountKobo: 0,
          planType: 'premium',
          hasCopierAccess: true,
          startedAt: new Date(),
          expiresAt: expiresAt
        }
      })

      // Create invite link and add to channel
      const inviteLink = await createInviteLink()

      await sendMessage(user.id, `🎉 <b>Promo Code Activated!</b>

━━━━━━━━━━━━━━━━━━━

✅ <b>EXTRA2 Promo - 2 Weeks Premium Access!</b>

📅 <b>Expires:</b> ${expiresAt.toLocaleDateString()}

━━━━━━━━━━━━━━━━━━━

🔗 <b>Join Channel:</b>
${inviteLink}

━━━━━━━━━━━━━━━━━━━

⚠️ <b>Important:</b>
• Click the link above to join the VIP channel
• Access valid for 14 days from today
• Enjoy free VIP signals!
• Meta Copier access included!

━━━━━━━━━━━━━━━━━━━

Want to extend? Type /pay to see our plans!`)

      processingReferences.delete(cleanRef)
      return
    }

    if (promoCode === 'VIP') {
      // Check if user already redeemed this promo code
      const existingPromo = await prisma.subscription.findFirst({
        where: {
          telegramUserId: userId,
          paystackRef: { equals: cleanRef, mode: 'insensitive' }
        }
      })

      if (existingPromo) {
        await sendMessage(user.id, `❌ <b>Already Redeemed!</b>

━━━━━━━━━━━━━━━━━━━

You've already used this promo code!

━━━━━━━━━━━━━━━━━━━

💡 Each promo code can only be used once per user.

Type /pay to see our plans!`)
        processingReferences.delete(cleanRef)
        return
      }

      // 1 week free access (Basic plan)
      const days = 7
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + days)

      // Create subscription
      await prisma.subscription.create({
        data: {
          telegramUserId: userId,
          telegramUsername: user.username,
          telegramName: user.first_name,
          paystackRef: cleanRef,
          amountKobo: 0,
          planType: 'basic',
          hasCopierAccess: false,
          startedAt: new Date(),
          expiresAt: expiresAt
        }
      })

      // Create invite link and add to channel
      const inviteLink = await createInviteLink()

      await sendMessage(user.id, `🎉 <b>Promo Code Activated!</b>

━━━━━━━━━━━━━━━━━━━

✅ <b>VIP Promo - 1 Week Free Access!</b>

📅 <b>Expires:</b> ${expiresAt.toLocaleDateString()}

━━━━━━━━━━━━━━━━━━━

🔗 <b>Join Channel:</b>
${inviteLink}

━━━━━━━━━━━━━━━━━━━

⚠️ <b>Important:</b>
• Click the link above to join the VIP channel
• Access valid for 7 days from today
• Enjoy free VIP signals!

━━━━━━━━━━━━━━━━━━━

Want to extend? Type /pay to see our plans!`)

      processingReferences.delete(cleanRef)
      return
    }

    if (promoCode === 'DISCOUNT') {
      // Generate DISCOUNT promo payment link (₦3,000, 7 days)
      processingReferences.delete(cleanRef)

      const promoResponse = await fetch(`${APP_URL}/api/payment/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: userId,
          telegramUsername: user.username || 'unknown',
          planType: 'promo',
          email: `${user.username || 'user'}@pearsignals.com`,
          metadata: {
            promoCode: 'DISCOUNT'
          }
        })
      })

      const promoData = await promoResponse.json()

      if (!promoData.success) {
        await sendMessage(user.id, '❌ Failed to generate payment link. Please try again.')
        return
      }

      // Send payment link with button
      await sendMessageWithKeyboard(user.id, `🎁 <b>DISCOUNT Promo - Special Offer!</b>

━━━━━━━━━━━━━━━━━━━

✨ <b>Get 1 Week Basic Access for ₦3,000!</b>

<b>Normal price:</b> ₦5,000
<b>Discount price:</b> ₦3,000
<b>You save:</b> ₦2,000! (40% off)

━━━━━━━━━━━━━━━━━━━

<b>Plan details:</b>
• 7 days access to VIP signals
• Manual copy trading
• Perfect for trying out at discount price!

━━━━━━━━━━━━━━━━━━━

<i>Click below to complete your payment!</i>`,
        {
          inline_keyboard: [
              [
                { text: '🔥 Pay ₦3,000 (7 Days)', url: promoData.authorizationUrl }
              ],
              [
                { text: '✅ Verify Payment', callback_data: 'verify_promo' }
              ]
          ]
        })
      return
    }

    // Check if reference is already used (for Paystack transactions only)
    const existingSubscription = await prisma.subscription.findFirst({
      where: { paystackRef: cleanRef }
    })

    if (existingSubscription) {
      await sendMessage(user.id, `❌ <b>Reference Already Used!</b>

━━━━━━━━━━━━━━━━━━━

This transaction reference has already been redeemed.

━━━━━━━━━━━━━━━━━━━

<b>What to do:</b>
• Wait for the next promo broadcast
• Each broadcast has FRESH payment links
• Old links stop working after one purchase

━━━━━━━━━━━━━━━━━━━

Type /pay to see our regular plans!`)
      return
    }

    // Verify transaction with Paystack
    const verification = await verifyTransaction(cleanRef)

    if (!verification.success) {
      const remaining = getRemainingAttempts(userId)
      await sendMessage(user.id, `❌ <b>Invalid Reference!</b>

━━━━━━━━━━━━━━━━━━━

We couldn't find this transaction.

━━━━━━━━━━━━━━━━━━━

<b>What to check:</b>
• You copied the reference correctly (no spaces)
• The payment was made successfully
• You're using the correct reference

━━━━━━━━━━━━━━━━━━━

<b>Remaining attempts:</b> ${remaining} of ${RATE_LIMIT.maxAttempts}

<b>Try again:</b>
Paste the reference number below (e.g., iby0ro0awd)

Or send /pay to make a new payment`)
      // Don't record failed attempt for invalid reference - let them try again
      return
    }

    // Validate payment status
    if (verification.status !== 'success') {
      const remaining = recordFailedAttempt(userId)
      if (remaining === 0) {
        await sendMessage(user.id, `❌ <b>Payment Not Completed!</b>

━━━━━━━━━━━━━━━━━━━

This payment hasn't been completed successfully.

━━━━━━━━━━━━━━━━━━━

Too many failed attempts. Please try again in 1 hour.`)
      } else {
        await sendMessage(user.id, `❌ <b>Payment Not Completed!</b>

━━━━━━━━━━━━━━━━━━━

This payment hasn't been completed successfully.

━━━━━━━━━━━━━━━━━━━

<b>Remaining attempts:</b> ${remaining} of ${RATE_LIMIT.maxAttempts}

Please complete the payment first, then verify again.

Or send /pay to make a new payment`)
      }
      return
    }

    // Validate payment channel
    if (!validatePaymentChannel(verification.channel || '')) {
      const remaining = recordFailedAttempt(userId)
      if (remaining === 0) {
        await sendMessage(user.id, `❌ Invalid payment channel. Please pay using bank transfer or card.

Too many failed attempts. Please try again in 1 hour.`)
      } else {
        await sendMessage(user.id, `❌ Invalid payment channel. Please pay using bank transfer or card.

Remaining attempts: ${remaining} of ${RATE_LIMIT.maxAttempts}`)
      }
      return
    }

    // Check if promo payment link has expired (2 days)
    if (planType === 'promo') {
      // Extract broadcast timestamp from transaction metadata
      const metadataTimestamp = verification.metadata?.broadcastTimestamp
      let broadcastTimestamp: number | undefined

      if (metadataTimestamp) {
        broadcastTimestamp = parseInt(metadataTimestamp, 10)
      }

      if (broadcastTimestamp) {
        const now = Date.now()
        const hoursSinceBroadcast = (now - broadcastTimestamp) / (1000 * 60 * 60)

        if (hoursSinceBroadcast > PROMO_EXPIRY_HOURS) {
          const remaining = getRemainingAttempts(userId)
          await sendMessage(user.id, `❌ <b>Promo Link Expired!</b>

━━━━━━━━━━━━━━━━━━━

This promo link was sent more than 2 days ago.

Promo links expire after ${PROMO_EXPIRY_HOURS} hours to ensure fair pricing.

━━━━━━━━━━━━━━━━━━━

<b>What to do:</b>
• Wait for the next promo broadcast
• New broadcasts create fresh links
• Or use /pay to see regular plans

━━━━━━━━━━━━━━━━━━━

<b>Remaining attempts:</b> ${remaining} of ${RATE_LIMIT.maxAttempts}`)
          return
        }
      }
    }

    // Get expected amount for the plan
    const expectedAmount = PLANS[planType].amountKobo

    // Check if payment amount matches the plan (with cross-check for wrong command usage)
    const amountValidation = validatePaymentAmount(verification.amount!, expectedAmount)

    if (!amountValidation.valid) {
      const remaining = recordFailedAttempt(userId)
      // Check if user used wrong command
      // Try to find which plan the user actually paid for
      let actualPaidPlan: PlanType | null = null
      for (const plan of ['basic', 'biweekly', 'monthly', 'promo', 'premium'] as PlanType[]) {
        if (verification.amount === PLANS[plan].amountKobo) {
          actualPaidPlan = plan
          break
        }
      }

      if (actualPaidPlan && actualPaidPlan !== planType) {
        await sendMessage(user.id, `❌ You used /verify_${planType} but paid for the ${actualPaidPlan.charAt(0).toUpperCase() + actualPaidPlan.slice(1)} plan (NGN ${(PLANS[actualPaidPlan].amountKobo / 100).toLocaleString()}).

Please use /verify_${actualPaidPlan} ${cleanRef} instead.

Remaining attempts: ${remaining} of ${RATE_LIMIT.maxAttempts}`)
      } else {
        await sendMessage(user.id, `❌ ${amountValidation.message}

Use /verify_basic for Basic (NGN 5,000), /verify_biweekly for Bi-Weekly (NGN 10,000), /verify_monthly for Monthly (NGN 15,000), /verify_promo for Promo (NGN 3,000), or /verify_premium for Premium (NGN 22,000)

Remaining attempts: ${remaining} of ${RATE_LIMIT.maxAttempts}`)
      }
      return
    }

    // Check if user was previously removed from the channel and unban them
    const previousRemovedSubscriptions = await prisma.subscription.findMany({
      where: {
        telegramUserId: userId,
        isRemoved: true
      }
    })

    if (previousRemovedSubscriptions.length > 0) {
      // User was previously removed, unban them so they can rejoin
      const unbanned = await unbanChatMember(user.id)
      if (unbanned) {
        console.log(`Unbanned user ${userId} who is repaying`)
      }
    }

    // Create invite link
    const inviteLink = await createInviteLink()

    if (!inviteLink) {
      const remaining = recordFailedAttempt(userId)
      if (remaining === 0) {
        await sendMessage(user.id, `❌ Failed to generate invite link. Please try again or contact support.

Too many failed attempts. Please try again in 1 hour.`)
      } else {
        await sendMessage(user.id, `❌ Failed to generate invite link. Please try again or contact support.

Remaining attempts: ${remaining} of ${RATE_LIMIT.maxAttempts}`)
      }
      return
    }

    // Calculate expiry date
    const expiresAt = calculateExpiryDate(planType)

    // Save subscription to database
    try {
      await prisma.subscription.create({
        data: {
          telegramUserId: user.id.toString(),
          telegramUsername: user.username,
          telegramName: `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`,
          paystackRef: cleanRef,
          customerEmail: verification.customerEmail,
          amountKobo: verification.amount!,
          planType,
          hasCopierAccess: PLANS[planType].hasCopierAccess,
          startedAt: new Date(),
          expiresAt,
          inviteLinkUsed: inviteLink
        }
      })
    } catch (error) {
      console.error('Error saving subscription:', error)
      await sendMessage(user.id, '❌ An error occurred while saving your subscription. Please contact support.')
      return
    }

    // Reset rate limit on success
    resetRateLimit(userId)

    // Send success message
    const planName = PLANS[planType].name
    const formattedAmount = formatAmount(verification.amount!)
    const formattedExpiry = formatDate(expiresAt)

    let successMessage = `✅ Payment Verified Successfully!

💎 Plan: ${planName}
💰 Amount: ${formattedAmount}
📅 Access expires: ${formattedExpiry}

Here is your one-time invite link (valid for 24 hours):
👉 ${inviteLink}

Click the link to join the channel. The link can only be used once.

Type /status anytime to check your subscription.`

    if (PLANS[planType].hasCopierAccess) {
      successMessage += `

━━━━━━━━━━━━━━━━━━━

🤖 <b>MT5 AUTO COPIER ACTIVATED!</b>

━━━━━━━━━━━━━━━━━━━

⚠️ <b>CRITICAL REQUIREMENTS:</b>

<b>1. YOUR ACCOUNT MUST BE A CENT ACCOUNT!</b>
❌ Standard Account - <b>WILL NOT WORK</b>
✅ Cent Account - <b>REQUIRED</b>

<b>2. SCALING: DISABLED (No Scaling)</b>
💡 Copy trades exactly as master opens them

<b>3. MAGIC NUMBER: 123456</b>
🔢 Set this in your MT5 EA settings

<b>4. REGION: LONDON</b>
🌍 Your copier will use London region

━━━━━━━━━━━━━━━━━━━

<b>Copy Settings Explained Simply:</b>

📊 <b>Multiplier (1.0x):</b>
<i>"Default setting - Copy same size as master"</i>

<b>Examples in baby language:</b>
• 1.0x = Master opens 0.01 → You open 0.01 ✅
• 2.0x = Master opens 0.01 → You open 0.02 📈
• 3.0x = Master opens 0.01 → You open 0.03 🚀

<i>"Higher multiplier = Bigger trades = More profit BUT more risk!"</i>

📏 <b>Max Lot (0.2):</b>
<i>"Biggest trade we'll copy is 0.2 lots"</i>

🔢 <b>Max Positions (10):</b>
<i>"Maximum 10 trades at the same time"</i>

━━━━━━━━━━━━━━━━━━━

🎁 <b>DON'T HAVE A HEADWAY ACCOUNT?</b>

Create one here and get <b>$100 BONUS!</b>
👉 https://headway.partners/user/signup?hwp=82067c

━━━━━━━━━━━━━━━━━━━

<b>To set up your copier, type:</b>
/mt5setup

Or skip for now - you have access for your full 14 days!`
    }

    await sendMessage(user.id, successMessage)

    // If Premium plan, trigger MT5 setup flow
    console.log(`[MT5 Setup Check] PlanType: ${planType}, hasCopierAccess: ${PLANS[planType].hasCopierAccess}`)

    if (PLANS[planType].hasCopierAccess) {
      console.log(`[MT5 Setup] Starting MT5 setup flow for user ${userId}`)

      // Auto-start the setup flow
      await setConversationState(userId, {
        step: 'account_number',
        data: {}
      })

      console.log(`[MT5 Setup] Conversation state set for user ${userId}`)
    } else {
      console.log(`[MT5 Setup] Plan ${planType} does not have copier access. Skipping MT5 setup.`)
    }
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
      copyTakeProfit: subscription.mt5Setup.copyTakeProfit
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

    // Create MetaCopier account
    const mcAccount = await createMt5Account({
      loginAccountNumber: state.data.accountNumber,
      loginAccountPassword: state.data.password,
      loginServer: state.data.server,
      region: { id: 2 }, // 2 = London region in MetaCopier
      type: { id: 1 }    // 1 = MT5 account type in MetaCopier
    })

    // Encrypt password
    const encryptedPassword = encryptPassword(state.data.password)

    // Save to database
    await prisma.mt5Setup.create({
      data: {
        subscriptionId: subscription.id,
        loginAccountNumber: state.data.accountNumber,
        loginAccountPassword: encryptedPassword,
        loginServer: state.data.server,
        regionId: 2, // London region ID in MetaCopier
        metacopierAccountId: mcAccount.accountId,
        metacopierCopierId: mcAccount.copierId,
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

    if (errorMessage.includes('LOGIN_SERVER_NOT_FOUND')) {
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
    } else if (errorMessage.includes('authentication') || errorMessage.includes('credentials') || errorMessage.includes('unauthorized') || errorMessage.includes('401') || errorMessage.includes('403')) {
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
        copyTakeProfit: pending.copyTakeProfit ?? subscription.mt5Setup.copyTakeProfit
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
          copyTakeProfit: updateParams.copyTakeProfit
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

      // Handle MT5 setup and settings callbacks first
      if (data.startsWith('mt5_') || data.startsWith('settings_') || data.startsWith('lotsize_') || data.startsWith('maxlot_') || data.startsWith('maxpositions_')) {
        await handleMt5Callback(from, id, data, message?.message_id)
        return NextResponse.json({ ok: true })
      }

      // Answer the callback query to remove the loading state
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: id,
          text: '✅ Please send your transaction reference'
        })
      })

      // Handle verify payment button clicks
      if (data === 'verify_basic' || data === 'verify_biweekly' || data === 'verify_monthly' || data === 'verify_promo' || data === 'verify_premium') {
        const planType: PlanType = data === 'verify_basic' ? 'basic' : data === 'verify_biweekly' ? 'biweekly' : data === 'verify_monthly' ? 'monthly' : data === 'verify_promo' ? 'promo' : 'premium'

        // Mark user as waiting for reference
        pendingVerificationUsers.set(userId, planType)

        // Send photo with instructions
        const planNames = {
          basic: 'Basic (₦5,000)',
          biweekly: 'Bi-Weekly (₦10,000)',
          monthly: 'Monthly (₦15,000)',
          promo: 'Promo (₦3,000)',
          premium: 'Premium (₦22,000)'
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

    // Debug logging
    console.log('Received text:', text)
    console.log('Parsed parts:', parts)
    console.log('Command:', command)
    console.log('Args:', args)

    const userId = from.id.toString()

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

    // Check if user is in MT5 setup conversation flow
    const conversationState = await getConversationState(userId)
    if (conversationState && !command.startsWith('/')) {
      await handleMt5Conversation(from, text!)
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

      case '/cancel':
        if (pendingEmailUsers.has(userId)) {
          pendingEmailUsers.delete(userId)
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
          await handleVerify(from, args[0], 'basic')
        }
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

      case '/broadcast_active':
        await handleBroadcastActive(from, args)
        break

      case '/broadcast_premium':
        await handleBroadcastPremium(from, args)
        break

      case '/broadcast_promo':
        await handleBroadcastPromo(from)
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
