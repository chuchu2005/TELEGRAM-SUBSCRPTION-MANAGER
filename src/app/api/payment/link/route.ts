import { NextRequest, NextResponse } from 'next/server'
import { PLANS, PlanType, TRIAL_DISCOUNT } from '@/lib/config'
import { prisma } from '@/lib/prisma'

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!

export interface CreatePaymentLinkRequest {
  telegramId: string
  telegramUsername?: string
  planType: PlanType
  email?: string
}

export interface PaystackInitResponse {
  status: boolean
  message: string
  data?: {
    authorization_url: string
    access_code: string
    reference: string
  }
}

/**
 * POST /api/payment/link
 * Creates a Paystack payment link with bank transfer only
 */
export async function POST(request: NextRequest) {
  try {
    const body: CreatePaymentLinkRequest = await request.json()
    const { telegramId, telegramUsername, planType, email } = body

    if (!telegramId || !planType) {
      return NextResponse.json(
        { error: 'Missing required fields: telegramId, planType' },
        { status: 400 }
      )
    }

    // Get plan details
    const plan = PLANS[planType]
    const planName = plan.name.charAt(0).toUpperCase() + plan.name.slice(1)
    let amountKobo: number = plan.amountKobo

    // Check discount eligibility if it's a standard paid plan (not promo or trial)
    if (planType !== 'trial' && planType !== 'promo' && TRIAL_DISCOUNT.enabled) {
      const now = new Date()
      const twentyFourHoursAgo = new Date(now.getTime() - (TRIAL_DISCOUNT.discountDurationHours * 60 * 60 * 1000))

      const recentTrial = await prisma.subscription.findFirst({
        where: {
          telegramUserId: telegramId.toString(),
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
          amountKobo = Math.floor(amountKobo * (1 - TRIAL_DISCOUNT.discountPercent / 100))
        }
      }
    }

    // Use provided email or fallback
    const customerEmail = email || `customer_${telegramId}@example.com`

    // Initialize transaction with Paystack
    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: customerEmail,
        amount: amountKobo,
        currency: 'NGN',
        channels: ['bank_transfer'], // ONLY bank transfer
        metadata: {
          product: 'telegram_bot_subscription',
          plan_type: planType,
          telegram_id: telegramId,
          telegram_username: telegramUsername || 'unknown',
          plan_name: planName,
          customer_email: customerEmail,
          custom_fields: [
            {
              display_name: 'Plan Type',
              variable_name: 'plan_type',
              value: planType
            },
            {
              display_name: 'Telegram ID',
              variable_name: 'telegram_id',
              value: telegramId
            },
            {
              display_name: 'Customer Email',
              variable_name: 'customer_email',
              value: customerEmail
            }
          ]
        },
        // We'll add reference to callback URL via query param after transaction
        // But Paystack doesn't support this, so reference will be shown on success page
      })
    })

    const paystackData: PaystackInitResponse = await paystackResponse.json()

    if (!paystackData.status || !paystackData.data) {
      return NextResponse.json(
        { error: 'Failed to create payment link', details: paystackData.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      authorizationUrl: paystackData.data.authorization_url,
      reference: paystackData.data.reference,
      plan: planType,
      amount: amountKobo
    })
  } catch (error) {
    console.error('Error creating payment link:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
