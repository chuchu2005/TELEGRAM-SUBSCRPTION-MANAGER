import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMessage, sendPhoto, createInviteLink, formatDate, getDaysRemaining, unbanChatMember } from '@/lib/telegram'
import { verifyTransaction, validatePaymentAmount, validatePaymentChannel, formatAmount } from '@/lib/paystack'
import { PLANS, PlanType, BANK_DETAILS, CHANNEL_NAME, RATE_LIMIT, calculateExpiryDate } from '@/lib/config'
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
├─ 7 days access
├─ VIP group only
└─ Perfect for trying out

👑 <b>Premium Plan</b> - ₦22,000
├─ 14 days access
├─ VIP group + Auto Copier Bot
└─ Best value for serious traders

━━━━━━━━━━━━━━━━━━━

<b>📋 Quick Start:</b>
1️⃣ Send /pay to get payment link
2️⃣ Complete payment securely
3️⃣ Copy your reference & send to bot
4️⃣ Receive invite link instantly!

<b>Need help?</b> Send /help

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
💎 Basic (₦5,000) - 7 days
👑 Premium (₦22,000) - 14 days + Copier Bot

<b>Step 3: Make Payment</b>
• Pay securely with bank transfer
• Payment is instant & automatic

<b>Step 4: Get Your Reference</b>
• After payment, you'll see a receipt
• Copy the reference (e.g., TXN_1234567890)
• It looks like: REF_######## or ########

<b>Step 5: Verify & Get Access</b>
• Send: /verify_basic YOUR_REFERENCE
• Or: /verify_premium YOUR_REFERENCE
• Bot verifies instantly → sends invite link

━━━━━━━━━━━━━━━━━━━

<b>❓ Frequently Asked Questions</b>

<i>Q: What if I don't have a reference?</i>
A: Make sure you copy it from the Paystack success page after payment.

<i>Q: How long does the invite link last?</i>
A: 24 hours from when it was created.

<i>Q: Can I renew after it expires?</i>
A: Yes! Just pay again and verify the new reference.

<i>Q: I'm stuck. What do I do?</i>
A: Send /pay to start over, or /status to check your current subscription.

━━━━━━━━━━━━━━━━━━━

<i>Ready? Send /pay to begin!</i>`

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

    if (!basicData.success || !premiumData.success) {
      console.error('Payment link generation failed:', { basicData, premiumData })
      await sendMessage(user.id, '❌ Failed to generate payment links. Please try again later.\n\nSend /pay to start over.')
      return
    }

    const message = `✅ <b>Email Confirmed:</b> ${email}

━━━━━━━━━━━━━━━━━━━

💳 <b>Step 2: Choose Your Plan</b>

💎 <b>Basic Plan</b> - ₦5,000
├─ 7 days VIP access
└─ For trying out

👑 <b>Premium Plan</b> - ₦22,000
├─ 14 days VIP + Copier Bot
└─ Best value

━━━━━━━━━━━━━━━━━━━

<b>Tap a button below to pay securely:</b>

Payment via bank transfer only

After payment → You'll see your reference
Then send: /verify_basic REFERENCE

💡 Tip: You'll find the reference on the success page after payment

Or send /pay to start over

💎 Pay ₦5,000 (Basic)
👑 Pay ₦22,000 (Premium)

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
 * Handle /verify_basic command
 */
async function handleVerifyBasic(user: TelegramUser, reference: string): Promise<void> {
  await handleVerify(user, reference, 'basic')
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

    // Check if reference is already used
    const existingSubscription = await prisma.subscription.findUnique({
      where: { paystackRef: cleanRef }
    })

    if (existingSubscription) {
      await sendMessage(user.id, `❌ <b>Reference Already Used!</b>

━━━━━━━━━━━━━━━━━━━

This transaction reference has already been redeemed.

━━━━━━━━━━━━━━━━━━━

<b>What to do:</b>
• Make a new payment to get a new reference
• Use the new reference to verify

━━━━━━━━━━━━━━━━━━━

Type /pay to make a new payment and get a fresh reference!`)
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

    // Get expected amount for the plan
    const expectedAmount = PLANS[planType].amountKobo

    // Check if payment amount matches the plan (with cross-check for wrong command usage)
    const amountValidation = validatePaymentAmount(verification.amount!, expectedAmount)

    if (!amountValidation.valid) {
      const remaining = recordFailedAttempt(userId)
      // Check if user used wrong command
      const otherPlan: PlanType = planType === 'basic' ? 'premium' : 'basic'
      if (verification.amount === PLANS[otherPlan].amountKobo) {
        await sendMessage(user.id, `❌ You used /verify_${planType} but paid for the ${otherPlan.charAt(0).toUpperCase() + otherPlan.slice(1)} plan (NGN ${(PLANS[otherPlan].amountKobo / 100).toLocaleString()}).

Please use /verify_${otherPlan} ${cleanRef} instead.

Remaining attempts: ${remaining} of ${RATE_LIMIT.maxAttempts}`)
      } else {
        await sendMessage(user.id, `❌ ${amountValidation.message}

Use /verify_basic for Basic (NGN 5,000) or /verify_premium for Premium (NGN 22,000)

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
      successMessage += '\n\n🤖 You also have access to the Auto Copier Bot!'
    }

    await sendMessage(user.id, successMessage)
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
/verify_premium REF - Verify Premium plan payment
/status - Check your subscription
/help - Get help`)
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
      const { id, from, data } = callback_query
      const userId = from.id.toString()

      console.log('Received callback query:', data, 'from user:', userId)

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
      if (data === 'verify_basic' || data === 'verify_premium') {
        const planType: PlanType = data === 'verify_basic' ? 'basic' : 'premium'

        // Mark user as waiting for reference
        pendingVerificationUsers.set(userId, planType)

        // Send photo with instructions
        const planName = planType === 'basic' ? 'Basic (₦5,000)' : 'Premium (₦22,000)'
        const caption = `✅ <b>Verifying ${planName} Payment</b>

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

      case '/status':
        await handleStatus(from)
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
