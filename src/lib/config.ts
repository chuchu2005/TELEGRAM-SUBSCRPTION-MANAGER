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

// Broadcast Message Configuration — 4 daily drops (WAT hours as keys).
// Each send time also rotates within ~60 min of its target via vipbot-cron
// (see cron-worker) so it doesn't read as fully automated.
// Override via env: BROADCAST_MORNING_TEXT / BROADCAST_TPHIT_TEXT /
// BROADCAST_AFTERNOON_TEXT / BROADCAST_EVENING_TEXT / BROADCAST_BUTTON_TEXT.
export const BROADCAST_MESSAGES = {
  '9': { // 9am WAT — morning trade
    label: 'Morning',
    text: process.env.BROADCAST_MORNING_TEXT || "📈 <b>The MORNING trade just dropped in the VIP group.</b>\n\nXAUUSD is moving right now — our VIPs are already in the trade while you read this. ⏳\n\nDon't watch today's profits pass you by.",
    buttonText: process.env.BROADCAST_BUTTON_TEXT || "Join VIP"
  },
  '12': { // ~12pm WAT — TP-hit win recap
    label: 'Midday',
    text: process.env.BROADCAST_TPHIT_TEXT || "💰 <b>TP HIT on our XAUUSD call!</b>\n\nVIP members just took profit on this one — if you were in the group, you'd be up right now. 📊\n\nStop watching other people win. Join before the next signal drops.",
    buttonText: process.env.BROADCAST_BUTTON_TEXT || "Join VIP"
  },
  '15': { // 3pm WAT — afternoon trade
    label: 'Afternoon',
    text: process.env.BROADCAST_AFTERNOON_TEXT || "🔥 <b>AFTERNOON trade is LIVE in the VIP group.</b>\n\nThe session just opened up another XAUUSD setup — members are already positioned. ⚡\n\nEvery signal you miss is pips you'll never get back.",
    buttonText: process.env.BROADCAST_BUTTON_TEXT || "Join VIP"
  },
  '21': { // 9pm WAT — evening trade
    label: 'Evening',
    text: process.env.BROADCAST_EVENING_TEXT || "🌙 <b>EVENING trade just dropped.</b>\n\nLast setup of the day is live in the VIP group — VIPs are locked in and ready to ride it. 🎯\n\nThe market doesn't wait, and the next call won't either.",
    buttonText: process.env.BROADCAST_BUTTON_TEXT || "Join VIP"
  }
} as const

export type BroadcastHour = keyof typeof BROADCAST_MESSAGES
