import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyTransaction, validatePaymentAmount, validatePaymentChannel, formatAmount } from '@/lib/paystack'
import { sendMessage, createInviteLink, unbanChatMember, formatDate } from '@/lib/telegram'
import { PLANS, PlanType, calculateExpiryDate } from '@/lib/config'

/**
 * POST /api/payment/auto-verify
 * Automatically verifies payment and sends invite link
 * Called from payment success page
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { reference } = body

    if (!reference) {
      return NextResponse.json({ success: false, error: 'Reference is required' }, { status: 400 })
    }

    console.log('Auto-verifying payment:', reference)

    // Check if reference is already used
    const existingSubscription = await prisma.subscription.findUnique({
      where: { paystackRef: reference }
    })

    if (existingSubscription) {
      console.log('Reference already redeemed:', reference)
      return NextResponse.json({
        success: false,
        error: 'This transaction has already been redeemed'
      })
    }

    // Verify transaction with Paystack
    const verification = await verifyTransaction(reference)

    if (!verification.success) {
      console.error('Verification failed:', verification.error)
      return NextResponse.json({
        success: false,
        error: verification.error || 'Payment verification failed'
      })
    }

    // Validate payment status
    if (verification.status !== 'success') {
      return NextResponse.json({
        success: false,
        error: 'Payment was not completed successfully'
      })
    }

    // Validate payment channel
    if (!validatePaymentChannel(verification.channel || '')) {
      return NextResponse.json({
        success: false,
        error: 'Invalid payment method'
      })
    }

    // Get metadata from Paystack response
    const paystackResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    })

    const paystackData = await paystackResponse.json()

    if (!paystackData.status) {
      return NextResponse.json({
        success: false,
        error: 'Failed to fetch transaction details'
      })
    }

    // Extract metadata
    const metadata = paystackData.data.metadata || {}
    let telegramId = metadata.telegram_id
    let planType: PlanType = metadata.plan_type || 'basic'
    let telegramUsername = metadata.telegram_username
    let customerEmail = metadata.customer_email || paystackData.data.customer?.email

    // Try to get telegram_id from custom_fields if not in metadata
    if (!telegramId && metadata.custom_fields) {
      const tgField = metadata.custom_fields.find((f: any) => f.variable_name === 'telegram_id')
      if (tgField) telegramId = tgField.value

      const planField = metadata.custom_fields.find((f: any) => f.variable_name === 'plan_type')
      if (planField) planType = planField.value as PlanType

      const emailField = metadata.custom_fields.find((f: any) => f.variable_name === 'customer_email')
      if (emailField) customerEmail = emailField.value
    }

    // If no telegram_id in metadata, can't auto-verify
    if (!telegramId) {
      console.log('No telegram_id in metadata for reference:', reference)
      return NextResponse.json({
        success: false,
        error: 'Payment not linked to Telegram account'
      })
    }

    console.log('Auto-verifying for telegram_id:', telegramId, 'plan:', planType)

    // Get expected amount for the plan
    const expectedAmount = PLANS[planType].amountKobo
    const amountValidation = validatePaymentAmount(verification.amount!, expectedAmount)

    if (!amountValidation.valid) {
      return NextResponse.json({
        success: false,
        error: amountValidation.message
      })
    }

    // Check if user was previously removed and unban them
    const previousRemovedSubscriptions = await prisma.subscription.findMany({
      where: {
        telegramUserId: telegramId,
        isRemoved: true
      }
    })

    if (previousRemovedSubscriptions.length > 0) {
      await unbanChatMember(telegramId)
      console.log(`Unbanned user ${telegramId} who is repaying`)
    }

    // Create invite link
    const inviteLink = await createInviteLink()

    if (!inviteLink) {
      return NextResponse.json({
        success: false,
        error: 'Failed to create invite link'
      })
    }

    // Calculate expiry date
    const expiresAt = calculateExpiryDate(planType)

    // Save subscription to database
    try {
      await prisma.subscription.create({
        data: {
          telegramUserId: telegramId,
          telegramUsername,
          telegramName: paystackData.data.customer?.first_name || 'User',
          paystackRef: reference,
          customerEmail: paystackData.data.customer?.email,
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
      return NextResponse.json({
        success: false,
        error: 'Failed to save subscription'
      })
    }

    // Send invite link to user
    const planName = PLANS[planType].name
    const formattedAmount = formatAmount(verification.amount!)
    const formattedExpiry = formatDate(expiresAt)

    let message = `✅ Payment Verified Successfully!

💎 Plan: ${planName}
💰 Amount: ${formattedAmount}
📅 Access expires: ${formattedExpiry}

Here is your one-time invite link (valid for 24 hours):
👉 ${inviteLink}

Click the link to join the channel. The link can only be used once.

Type /status anytime to check your subscription.`

    if (PLANS[planType].hasCopierAccess) {
      message += '\n\n🤖 You also have access to the Auto Copier Bot!'
    }

    await sendMessage(telegramId, message)
    console.log(`Invite link sent to telegram user ${telegramId}`)

    return NextResponse.json({
      success: true,
      message: 'Payment verified and invite link sent',
      telegramId,
      planType
    })
  } catch (error) {
    console.error('Error in auto-verify:', error)
    return NextResponse.json({
      success: false,
      error: 'Auto-verification failed'
    })
  }
}
