/**
 * Promo Code Creation Inline Keyboards
 * Builds interactive button menus for admin promo code creation
 */

export interface InlineKeyboardButton {
  text: string
  callback_data: string
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][]
}

/**
 * Returns the complete promo creation keyboard with all 7 rows
 */
export function promoCreationKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      // Row 1: Plan Type
      [
        { text: '💎 Basic', callback_data: 'promo_plan_basic' },
        { text: '📊 Bi-Weekly', callback_data: 'promo_plan_biweekly' },
        { text: '📅 Monthly', callback_data: 'promo_plan_monthly' }
      ],
      // Row 2: Duration
      [
        { text: '7 days', callback_data: 'promo_duration_7' },
        { text: '14 days', callback_data: 'promo_duration_14' },
        { text: '30 days', callback_data: 'promo_duration_30' },
        { text: '✏️ Custom', callback_data: 'promo_duration_custom' }
      ],
      // Row 3: Price
      [
        { text: '🎁 FREE', callback_data: 'promo_price_free' },
        { text: '💵 PAID', callback_data: 'promo_price_paid' }
      ],
      // Row 4: Copier Access
      [
        { text: '❌ No Copier', callback_data: 'promo_copier_no' },
        { text: '✅ With Copier', callback_data: 'promo_copier_yes' }
      ],
      // Row 5: Display Name
      [
        { text: '✅ Add Name', callback_data: 'promo_name_yes' },
        { text: '⏭️ Skip Name', callback_data: 'promo_name_skip' }
      ],
      // Row 6: Expiry
      [
        { text: '📅 90 days', callback_data: 'promo_expiry_90' },
        { text: '📅 180 days', callback_data: 'promo_expiry_180' },
        { text: '📅 1 year', callback_data: 'promo_expiry_365' },
        { text: '♾️ Never', callback_data: 'promo_expiry_never' }
      ],
      // Row 7: Usage Limit
      [
        { text: '♾️ Unlimited', callback_data: 'promo_limit_unlimited' },
        { text: '👥 50 users', callback_data: 'promo_limit_50' },
        { text: '👥 100 users', callback_data: 'promo_limit_100' },
        { text: '✏️ Custom', callback_data: 'promo_limit_custom' }
      ]
    ]
  }
}
