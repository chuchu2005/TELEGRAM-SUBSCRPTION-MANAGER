import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendMessage, createInviteLink, unbanChatMember, formatDate } from '@/lib/telegram'
import { calculateExpiryDate, PLANS, PlanType } from '@/lib/config'

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!

interface PaystackWebhookEvent {
  event: string
  data: {
    status: string
    reference: string
    amount: number
    channel: string
    customer: {
      email: string
      first_name?: string
      last_name?: string
      metadata?: {
        telegram_id?: string
        telegram_username?: string
        plan_type?: PlanType
        plan_name?: string
        product?: string
        customer_email?: string
      }
    }
    metadata?: {
      telegram_id?: string
      telegram_username?: string
      plan_type?: PlanType
      plan_name?: string
      product?: string
      customer_email?: string
      custom_fields?: Array<{
        variable_name: string
        value: string
      }>
    }
    paid_at: string
  }
}

/**
 * POST handler for Paystack webhook
 * Automatically processes payments with metadata
 */
export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text()
    const signature = request.headers.get('x-paystack-signature')

    // Verify webhook signature
    if (!signature) {
      console.error('No Paystack signature provided')
      return NextResponse.json({ error: 'No signature provided' }, { status: 401 })
    }

    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest('hex')

    if (hash !== signature) {
      console.error('Invalid Paystack webhook signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    // Parse webhook event
    const event: PaystackWebhookEvent = JSON.parse(rawBody)

    // Handle charge.success event
    if (event.event === 'charge.success') {
      const { data } = event

      // Check if reference is already processed
      const existingSubscription = await prisma.subscription.findUnique({
        where: { paystackRef: data.reference }
      })

      if (existingSubscription) {
        console.log(`Reference ${data.reference} already processed`)
        return NextResponse.json({ status: 'already processed' })
      }

      // Extract metadata
      const metadata = data.metadata || data.customer?.metadata || {}
      let telegramId = metadata.telegram_id
      let planType: PlanType = metadata.plan_type || 'basic'
      let telegramUsername = metadata.telegram_username
      let customerEmail = metadata.customer_email || data.customer?.email

      // Try to get telegram_id and customer_email from custom_fields if not in metadata
      // Only data.metadata has custom_fields, not data.customer.metadata
      if (!telegramId && data.metadata?.custom_fields) {
        const tgField = data.metadata.custom_fields.find(f => f.variable_name === 'telegram_id')
        if (tgField) telegramId = tgField.value

        const planField = data.metadata.custom_fields.find(f => f.variable_name === 'plan_type')
        if (planField) planType = planField.value as PlanType

        const emailField = data.metadata.custom_fields.find(f => f.variable_name === 'customer_email')
        if (emailField) customerEmail = emailField.value
      }

      // If no telegram_id in metadata, log and skip (manual verification required)
      if (!telegramId) {
        console.log(`Payment ${data.reference} has no telegram_id in metadata. Manual verification required.`)
        return NextResponse.json({
          status: 'received',
          message: 'Payment received but requires manual verification (no telegram_id in metadata)'
        })
      }

      console.log(`Processing automatic payment for telegram_id: ${telegramId}, plan: ${planType}`)

      // Get plan details
      const plan = PLANS[planType]
      const expiresAt = calculateExpiryDate(planType)

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
        console.error('Failed to create invite link for telegram user', telegramId)
        return NextResponse.json({ error: 'Failed to create invite link' }, { status: 500 })
      }

      // Save subscription to database
      try {
        await prisma.subscription.create({
          data: {
            telegramUserId: telegramId,
            telegramUsername,
            telegramName: `${data.customer.first_name || ''} ${data.customer.last_name || ''}`.trim() || 'User',
            paystackRef: data.reference,
            customerEmail: data.customer.email,
            amountKobo: data.amount,
            planType,
            hasCopierAccess: plan.hasCopierAccess,
            startedAt: new Date(),
            expiresAt,
            inviteLinkUsed: inviteLink
          }
        })
      } catch (error) {
        console.error('Error saving subscription:', error)
        return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
      }

      // Send invite link to user
      const planName = plan.name
      const formattedAmount = `NGN ${(data.amount / 100).toLocaleString()}`
      const formattedExpiry = formatDate(expiresAt)

      let message = `✅ Payment Verified Successfully!

💎 Plan: ${planName}
💰 Amount: ${formattedAmount}
📅 Access expires: ${formattedExpiry}

Here is your one-time invite link (valid for 24 hours):
👉 ${inviteLink}

Click the link to join the channel. The link can only be used once.

Type /status anytime to check your subscription.`

      if (plan.hasCopierAccess) {
        message += '\n\n🤖 You also have access to the Auto Copier Bot!'
      }

      await sendMessage(telegramId, message)
      console.log(`Invite link sent to telegram user ${telegramId}`)

      return NextResponse.json({
        success: true,
        message: 'Payment processed and invite link sent',
        telegramId,
        planType
      })
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Error in Paystack webhook:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

// Verify webhook endpoint is accessible
export async function GET(request: NextRequest) {
  return NextResponse.json({ status: 'Paystack webhook is running' })
}
