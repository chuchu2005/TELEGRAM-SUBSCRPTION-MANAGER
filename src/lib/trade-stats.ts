/**
 * Trade Statistics Generator
 * Generates randomized but realistic trade statistics for the Telegram bot
 */

export interface TradeStatistics {
  totalTrades: number
  hitTP: number
  hitSL: number
  winRate: number
  lossRate: number
  totalProfit: number
  pipsGained: number
  monthName: string
  year: number
}

export const TRADE_STATS_RANGES = {
  totalTrades: { min: 80, max: 150 },
  winRate: { min: 95, max: 95 }, // Fixed at 95% win rate (5% loss)
  profitPerTrade: { min: 15, max: 35 }, // USD average per winning trade
  lossPerTrade: { min: 10, max: 25 }, // USD average per losing trade
  pipsPerWin: { min: 10, max: 25 },
  pipsPerLoss: { min: 5, max: 15 }
} as const

/**
 * Generate a random integer between min and max (inclusive)
 */
function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Get the full month name from a date
 */
function getMonthName(date: Date): string {
  return date.toLocaleString('en-US', { month: 'long' })
}

/**
 * Calculate win rate as a percentage
 */
function calculateWinRate(tp: number, sl: number): number {
  const total = tp + sl
  if (total === 0) return 0
  return Number(((tp / total) * 100).toFixed(1))
}

/**
 * Generate realistic trade statistics for the current month
 */
export function generateTradeStatistics(): TradeStatistics {
  const now = new Date()
  const monthName = getMonthName(now)
  const year = now.getFullYear()

  // Generate total trades within realistic range
  const totalTrades = getRandomInt(TRADE_STATS_RANGES.totalTrades.min, TRADE_STATS_RANGES.totalTrades.max)

  // Generate win rate within realistic range
  const winRate = getRandomInt(TRADE_STATS_RANGES.winRate.min, TRADE_STATS_RANGES.winRate.max)

  // Calculate TP and SL counts based on win rate
  const hitTP = Math.round((totalTrades * winRate) / 100)
  const hitSL = totalTrades - hitTP

  // Calculate actual win rate (may differ slightly due to rounding)
  const actualWinRate = calculateWinRate(hitTP, hitSL)
  const lossRate = Number((100 - actualWinRate).toFixed(1))

  // Generate average profit/loss per trade
  const avgProfitPerWin = getRandomInt(TRADE_STATS_RANGES.profitPerTrade.min, TRADE_STATS_RANGES.profitPerTrade.max)
  const avgLossPerLoss = getRandomInt(TRADE_STATS_RANGES.lossPerTrade.min, TRADE_STATS_RANGES.lossPerTrade.max)

  // Calculate total profit
  const totalProfit = (hitTP * avgProfitPerWin) - (hitSL * avgLossPerLoss)

  // Generate average pips per trade
  const avgPipsPerWin = getRandomInt(TRADE_STATS_RANGES.pipsPerWin.min, TRADE_STATS_RANGES.pipsPerWin.max)
  const avgPipsPerLoss = getRandomInt(TRADE_STATS_RANGES.pipsPerLoss.min, TRADE_STATS_RANGES.pipsPerLoss.max)

  // Calculate total pips
  const pipsGained = (hitTP * avgPipsPerWin) - (hitSL * avgPipsPerLoss)

  return {
    totalTrades,
    hitTP,
    hitSL,
    winRate: actualWinRate,
    lossRate,
    totalProfit,
    pipsGained,
    monthName,
    year
  }
}

/**
 * Format trade statistics for Telegram message
 */
export function formatStatsMessage(stats: TradeStatistics): string {
  return `━━━━━━━━━━━━━━━━━━━

📊 <b>Summary of Trades Taken This Month (${stats.monthName} ${stats.year})</b> by the Auto Copier Bot

🎯 Total Trades: ${stats.totalTrades}
✅ Hit TP: ${stats.hitTP} (${stats.winRate}% win rate)
❌ Hit SL: ${stats.hitSL} (${stats.lossRate}% loss rate)
💰 Total Profit: +$${stats.totalProfit.toLocaleString()}
📈 Pips Gained: +${stats.pipsGained.toLocaleString()} pips

━━━━━━━━━━━━━━━━━━━`
}
