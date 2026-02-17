import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/payment/callback
 * Handles payment callback from success page
 * This is just a notification - actual verification happens via Paystack webhook
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { reference } = body

    if (!reference) {
      return NextResponse.json(
        { error: 'Missing reference' },
        { status: 400 }
      )
    }

    // The actual verification happens via Paystack webhook
    // This callback just confirms the payment page was shown
    return NextResponse.json({
      success: true,
      message: 'Payment callback received. Check your Telegram for invite link.'
    })
  } catch (error) {
    console.error('Error in payment callback:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
