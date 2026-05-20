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
    amountKobo: 900000,  // NGN 9,000
    durationDays: 14,
    hasCopierAccess: false  // Disabled for now, keep for future
  },
  monthly: {
    name: 'Monthly VIP',
    amountKobo: 1800000,  // NGN 18,000
    durationDays: 30,
    hasCopierAccess: false  // Disabled for now, keep for future
  },
  promo: {
    name: 'Promo VIP',
    amountKobo: 300000,  // NGN 3,000
    durationDays: 7,
    hasCopierAccess: false
  },
  trial: {
    name: 'Free Trial',
    amountKobo: 0,  // FREE
    durationDays: 1,  // 24 hours
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
export const GENERAL_CHANNEL_ID = '@pearforexsignals'
export const GENERAL_CHANNEL_NAME = 'Pear Forex Signals'

// Admin Telegram User ID (only this user can use /broadcast)
export const ADMIN_ID = 5472144783

// Trade Statistics Configuration
export const TRADE_STATS_CONFIG = {
  enabled: true,
  displayPosition: 'after_welcome', // Options: 'after_welcome', 'before_plans', 'after_plans'
  showDisclaimer: true
} as const

// Trial Discount Configuration
export const TRIAL_DISCOUNT = {
  enabled: true,
  discountPercent: 15, // 15% discount for trial users upgrading
  discountDurationHours: 24, // Discount valid for 24 hours after trial ends
  discountMessage: '🎉 EXCLUSIVE TRIAL OFFER! Upgrade within 24 hours and get 15% OFF all plans!'
} as const

// Helper function to get plan by type
export function getPlan(planType: PlanType) {
  return PLANS[planType]
}

// Helper function to calculate expiry date
export function calculateExpiryDate(planType: PlanType, baseDate?: Date): Date {
  const plan = getPlan(planType)
  const now = new Date()
  const startFrom = (baseDate && baseDate > now) ? baseDate : now

  const expiryDate = new Date(startFrom)
  expiryDate.setDate(expiryDate.getDate() + plan.durationDays)
  return expiryDate
}

// Broadcast Message Configuration
// Can be overridden by environment variables: BROADCAST_8AM_TEXT, BROADCAST_10AM_TEXT, BROADCAST_BUTTON_TEXT
export const BROADCAST_MESSAGES = {
  '8': {
    text: process.env.BROADCAST_8AM_TEXT || "1st XAUUSD Trade of the day just dropped in the VIP Group Now, Join now to take the trade",
    buttonText: process.env.BROADCAST_BUTTON_TEXT || "Join Now"
  },
  '10': {
    text: process.env.BROADCAST_10AM_TEXT || "Tp4 just hit on the xauusd trade dropped in the vip",
    buttonText: process.env.BROADCAST_BUTTON_TEXT || "Join Now"
  }
} as const

export type BroadcastHour = keyof typeof BROADCAST_MESSAGES
