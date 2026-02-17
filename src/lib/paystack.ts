import crypto from 'crypto'

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!
const PAYSTACK_API_BASE = 'https://api.paystack.co'

export interface PaystackTransaction {
  status: boolean
  message: string
  data: {
    status: string
    reference: string
    amount: number
    channel: string
    currency: string
    customer: {
      email: string
      customer_code: string
      first_name: string
      last_name: string
    }
    paid_at: string
    created_at: string
  }
}

export interface VerificationResult {
  success: boolean
  status?: string
  amount?: number
  customerEmail?: string
  channel?: string
  error?: string
}

/**
 * Verify a transaction with Paystack
 */
export async function verifyTransaction(reference: string): Promise<VerificationResult> {
  try {
    const response = await fetch(`${PAYSTACK_API_BASE}/transaction/verify/${reference}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    })

    const data: PaystackTransaction = await response.json()

    if (!data.status) {
      return {
        success: false,
        error: data.message || 'Transaction verification failed'
      }
    }

    const { status, amount, channel, customer } = data.data

    return {
      success: true,
      status,
      amount,
      customerEmail: customer?.email,
      channel
    }
  } catch (error) {
    console.error('Error verifying transaction with Paystack:', error)
    return {
      success: false,
      error: 'Payment system is temporarily unavailable. Please try again later.'
    }
  }
}

/**
 * Verify Paystack webhook signature
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  try {
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY!)
      .update(rawBody)
      .digest('hex')

    return hash === signature
  } catch (error) {
    console.error('Error verifying webhook signature:', error)
    return false
  }
}

/**
 * Validate payment against expected amount
 * Note: Paystack adds fees, so actual amount may be slightly higher than expected
 * - ₦5,000 plan: ~₦100-200 fees
 * - ₦22,000 plan: ~₦1,000 fees
 */
export function validatePaymentAmount(
  paymentAmount: number,
  expectedAmount: number
): { valid: boolean; message?: string } {
  const actualAmountNaira = paymentAmount / 100
  const expectedAmountNaira = expectedAmount / 100

  // Allow tolerance for Paystack charges (up to ₦1,500 extra for large transactions)
  const tolerance = 150000 // 150000 kobo = ₦1,500
  const amountDifference = Math.abs(paymentAmount - expectedAmount)

  // Amount must be at least the expected amount (can be more due to fees, but not significantly less)
  if (paymentAmount < expectedAmount - tolerance) {
    return {
      valid: false,
      message: `Payment amount (NGN ${actualAmountNaira.toLocaleString()}) is less than required (NGN ${expectedAmountNaira.toLocaleString()}).`
    }
  }

  // If amount is significantly different (more than tolerance), log it but still accept
  if (amountDifference > tolerance) {
    console.log(`Payment amount NGN ${actualAmountNaira.toLocaleString()} differs from expected NGN ${expectedAmountNaira.toLocaleString()} by NGN ${(amountDifference / 100).toLocaleString()}`)
  }

  return { valid: true }
}

/**
 * Validate payment channel
 */
export function validatePaymentChannel(channel: string): boolean {
  const validChannels = ['bank_transfer', 'card']
  return validChannels.includes(channel)
}

/**
 * Format amount from kobo to Naira for display
 */
export function formatAmount(amountKobo: number): string {
  return `NGN ${(amountKobo / 100).toLocaleString()}`
}
