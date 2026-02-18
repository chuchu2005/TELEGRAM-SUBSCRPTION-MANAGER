// Configuration for plans, bank details, and app settings

export const PLANS = {
  basic: {
    name: 'Basic VIP',
    amountKobo: 500000,  // NGN 5,000
    durationDays: 7,
    hasCopierAccess: false
  },
  biweekly: {
    name: 'Bi-Weekly VIP',
    amountKobo: 1000000,  // NGN 10,000
    durationDays: 14,
    hasCopierAccess: false
  },
  monthly: {
    name: 'Monthly VIP',
    amountKobo: 1500000,  // NGN 15,000
    durationDays: 30,
    hasCopierAccess: false
  },
  premium: {
    name: 'Premium VIP + Copier',
    amountKobo: 2200000,  // NGN 22,000
    durationDays: 14,
    hasCopierAccess: true
  },
  promo: {
    name: 'Promo VIP',
    amountKobo: 300000,  // NGN 3,000
    durationDays: 7,
    hasCopierAccess: false
  }
} as const

export type PlanType = keyof typeof PLANS

export const BANK_DETAILS = {
  bankName: 'PAYSTACK TITAN',
  accountNumber: '9740079311',
  accountName: 'learnrithmai/learnrithm ai'
}

export const RATE_LIMIT = {
  maxAttempts: 4,  // Allow 4 retries before blocking
  blockDurationMs: 3600000  // 1 hour
}

export const CHANNEL_NAME = 'Pear VIP signals channel'

// Admin Telegram User ID (only this user can use /broadcast)
export const ADMIN_ID = 5472144783

// Helper function to get plan by type
export function getPlan(planType: PlanType) {
  return PLANS[planType]
}

// Helper function to calculate expiry date
export function calculateExpiryDate(planType: PlanType): Date {
  const plan = getPlan(planType)
  const expiryDate = new Date()
  expiryDate.setDate(expiryDate.getDate() + plan.durationDays)
  return expiryDate
}
