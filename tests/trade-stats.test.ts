import { describe, expect, it } from 'vitest'
import { formatPerformanceSection, getPerformanceSummary } from '@/lib/trade-stats'

describe('performance summary [finding: fabricated_performance_content]', () => {
  it('reports that no verified data exists', () => {
    const summary = getPerformanceSummary()
    expect(summary.hasData).toBe(false)
    expect(summary.message).toMatch(/not available/i)
    expect(summary.message).toMatch(/no verified trade records/i)
  })

  it('never renders invented performance figures', () => {
    const section = formatPerformanceSection()
    // No win-rate percentages, trade counts, pip totals or profit figures.
    expect(section).not.toMatch(/win rate/i)
    expect(section).not.toMatch(/\d+\s*%/)
    expect(section).not.toMatch(/\d+\s*(trades|pips)/i)
    expect(section).not.toMatch(/\+\$\d/)
  })

  it('is deterministic (the removed generator was randomized per call)', () => {
    expect(formatPerformanceSection()).toBe(formatPerformanceSection())
    expect(getPerformanceSummary()).toEqual(getPerformanceSummary())
  })
})
