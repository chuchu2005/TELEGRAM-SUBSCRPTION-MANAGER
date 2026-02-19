/**
 * Telegram Inline Keyboard Builders
 * Creates interactive button menus for the Telegram bot
 */

export interface InlineKeyboardButton {
  text: string
  callback_data: string
}

export interface InlineKeyboardRow {
  inline_keyboard: InlineKeyboardButton[][]
}

export interface CopierSettings {
  copierMultiplier: number
  lotSize: number  // The actual lot size user wants to copy
  maxLotSize: number  // Maximum lot size per position
  maximumLot: number  // Maximum total exposure across all positions
  maxOpenPositions: number
  copyStopLoss: boolean
  copyTakeProfit: boolean
}

/**
 * Settings menu keyboard for copier configuration
 */
export function settingsKeyboard(currentSettings: CopierSettings): InlineKeyboardRow {
  return {
    inline_keyboard: [
      [
        { text: `📊 Lot Size: ${currentSettings.lotSize || 0.01}`, callback_data: 'settings_lotsize' }
      ],
      [
        { text: `📏 Max Lot Per Trade: ${currentSettings.maxLotSize}`, callback_data: 'settings_maxlot' }
      ],
      [
        { text: `📊 Max Total Exposure: ${currentSettings.maximumLot}`, callback_data: 'settings_maxlot_total' }
      ],
      [
        { text: `🔢 Max Positions: ${currentSettings.maxOpenPositions}`, callback_data: 'settings_maxpositions' }
      ],
      [
        { text: `🛑 SL: ${currentSettings.copyStopLoss ? '✅' : '❌'}`, callback_data: 'settings_sl' },
        { text: `🎯 TP: ${currentSettings.copyTakeProfit ? '✅' : '❌'}`, callback_data: 'settings_tp' }
      ],
      [
        { text: '💾 Save Settings', callback_data: 'settings_save' }
      ],
      [
        { text: '❌ Cancel', callback_data: 'settings_cancel' }
      ]
    ]
  }
}

/**
 * MT5 setup confirmation keyboard
 */
export function confirmSetupKeyboard(): InlineKeyboardRow {
  return {
    inline_keyboard: [
      [
        { text: '✅ Confirm & Activate', callback_data: 'mt5_confirm' },
        { text: '❌ Cancel', callback_data: 'mt5_cancel' }
      ]
    ]
  }
}

/**
 * Skip MT5 setup keyboard
 */
export function skipSetupKeyboard(): InlineKeyboardRow {
  return {
    inline_keyboard: [
      [
        { text: '⏭️ Skip for Now', callback_data: 'mt5_skip' }
      ]
    ]
  }
}

/**
 * Main menu keyboard for Premium users
 */
export function premiumMenuKeyboard(): InlineKeyboardRow {
  return {
    inline_keyboard: [
      [
        { text: '⚙️ Copier Settings', callback_data: 'menu_settings' },
        { text: '📊 My Stats', callback_data: 'menu_stats' }
      ],
      [
        { text: '🔄 Update MT5 Credentials', callback_data: 'menu_update_mt5' }
      ]
    ]
  }
}

/**
 * Lot size selection keyboard
 * Master trades with 0.01 lot size, so we calculate the multiplier
 */
export function lotSizeKeyboard(currentLotSize: number): InlineKeyboardRow {
  const options = [0.01, 0.02, 0.03, 0.05, 0.1]
  const buttons = options.map(value => ({
    text: value === currentLotSize ? `✅ ${value}` : `${value}`,
    callback_data: `lotsize_${value}`
  }))

  return {
    inline_keyboard: [
      buttons.slice(0, 3),
      buttons.slice(3),
      [{ text: '⬅️ Back', callback_data: 'settings_back' }]
    ]
  }
}

/**
 * Max lot size per trade selection keyboard
 */
export function maxLotKeyboard(currentMaxLot: number): InlineKeyboardRow {
  const options = [0.01, 0.02, 0.05, 0.1, 0.2]
  const buttons = options.map(value => ({
    text: value === currentMaxLot ? `✅ ${value}` : `${value}`,
    callback_data: `maxlot_${value}`
  }))

  return {
    inline_keyboard: [
      buttons.slice(0, 3),
      buttons.slice(3),
      [{ text: '⬅️ Back', callback_data: 'settings_back' }]
    ]
  }
}

/**
 * Maximum total exposure selection keyboard
 */
export function maxLotTotalKeyboard(currentMaxLot: number): InlineKeyboardRow {
  const options = [0.1, 0.2, 0.5, 1.0, 2.0]
  const buttons = options.map(value => ({
    text: value === currentMaxLot ? `✅ ${value}` : `${value}`,
    callback_data: `maxlot_total_${value}`
  }))

  return {
    inline_keyboard: [
      buttons.slice(0, 3),
      buttons.slice(3),
      [{ text: '⬅️ Back', callback_data: 'settings_back' }]
    ]
  }
}

/**
 * Max positions selection keyboard
 */
export function maxPositionsKeyboard(currentMaxPositions: number): InlineKeyboardRow {
  const options = [1, 3, 5, 10, 20]
  const buttons = options.map(value => ({
    text: value === currentMaxPositions ? `✅ ${value}` : `${value}`,
    callback_data: `maxpositions_${value}`
  }))

  return {
    inline_keyboard: [
      buttons.slice(0, 3),
      buttons.slice(3),
      [{ text: '⬅️ Back', callback_data: 'settings_back' }]
    ]
  }
}
