import { NextRequest, NextResponse } from 'next/server'
import { PLANS, PlanType } from '@/lib/config'

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
        amount: plan.amountKobo,
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
      amount: plan.amountKobo
    })
  } catch (error) {
    console.error('Error creating payment link:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
