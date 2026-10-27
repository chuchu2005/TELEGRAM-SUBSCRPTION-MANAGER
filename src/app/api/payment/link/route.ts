import { NextRequest, NextResponse } from 'next/server'
import { PLANS, PlanType, TRIAL_DISCOUNT } from '@/lib/config'
import { prisma } from '@/lib/prisma'

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!

export interface CreatePaymentLinkRequest {
  telegramId: string
  telegramUsername?: string
  /** A PLANS key, or a custom plan label (e.g. 'custom' for paid promos) — in which case amountKobo must be supplied. */
  planType: string
  email?: string
  /**
   * [finding: paid_promo_billing_defect] Explicit amount in kobo.
   * Required for custom plan types (paid promos) and overrides the plan price
   * for known plans (promo discounts). Without it, the price comes from PLANS.
   */
  amountKobo?: number
  /** Extra metadata (e.g. { promoCode }) merged into the Paystack metadata. */
  metadata?: Record<string, unknown>
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

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * POST /api/payment/link
 * Creates a Paystack payment link with bank transfer only.
 *
 * Amount resolution [finding: paid_promo_billing_defect]:
 *  - explicit `amountKobo` in the body wins (promo/custom pricing) — must be a
 *    positive integer in kobo;
 *  - otherwise the caller's `planType` must be a PLANS key and its configured
 *    price is used (with the trial-discount check for standard paid plans);
 *  - unknown plan types WITHOUT an explicit amount return a clear 400 instead
 *    of throwing a 500.
 */
export async function POST(request: NextRequest) {
  try {
    const body: CreatePaymentLinkRequest = await request.json()
    const { telegramId, telegramUsername, planType, email, amountKobo: callerAmountKobo, metadata: callerMetadata } = body

    if (!telegramId || !planType) {
      return NextResponse.json(
        { error: 'Missing required fields: telegramId, planType' },
        { status: 400 }
      )
    }

    const knownPlan = Object.prototype.hasOwnProperty.call(PLANS, planType)
      ? PLANS[planType as PlanType]
      : undefined

    let amountKobo: number
    let planName: string

    if (callerAmountKobo !== undefined) {
      if (!Number.isInteger(callerAmountKobo) || callerAmountKobo <= 0) {
        return NextResponse.json(
          { error: 'Invalid amountKobo: must be a positive integer amount in kobo' },
          { status: 400 }
        )
      }
      amountKobo = callerAmountKobo
      planName = knownPlan ? titleCase(knownPlan.name) : titleCase(planType)
    } else {
      if (!knownPlan) {
        return NextResponse.json(
          {
            error: `Unknown plan type '${planType}'. Valid plans: ${Object.keys(PLANS).join(', ')} — or pass an explicit amountKobo for custom/promo pricing.`
          },
          { status: 400 }
        )
      }
      planName = titleCase(knownPlan.name)
      amountKobo = knownPlan.amountKobo

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
            // Apply the configured trial-upgrade discount
            amountKobo = Math.floor(amountKobo * (1 - TRIAL_DISCOUNT.discountPercent / 100))
          }
        }
      }
    }

    // Use provided email or fallback
    const customerEmail = email || `customer_${telegramId}@example.com`

    const promoMetadata: Record<string, unknown> =
      callerMetadata && typeof callerMetadata === 'object' && !Array.isArray(callerMetadata)
        ? callerMetadata
        : {}

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
          // Caller-supplied promo/custom metadata first, canonical fields win
          // on key collisions so the payload stays self-describing.
          ...promoMetadata,
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
