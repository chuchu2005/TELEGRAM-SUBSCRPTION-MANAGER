/**
 * Trade performance reporting.
 *
 * [finding: fabricated_performance_content] This module previously GENERATED
 * randomized "monthly performance" figures — a trade count of 80-150, a win
 * rate pinned at 95%, invented USD profit and pip totals — and callers
 * presented that output to users and the admin as if it were achieved
 * results. That fabrication has been removed.
 *
 * The database (prisma/schema.prisma) has no trade-record model, so there is
 * currently no real performance data to derive statistics from. Until real,
 * sourced trade records exist, every caller renders this honest
 * insufficient-data state — never invented numbers. Any future real
 * implementation should derive the summary from persisted trade records and
 * set hasData=true only when verified records exist.
 */

export interface PerformanceSummary {
  hasData: boolean
  message: string
}

/**
 * Current performance summary. Deterministic and data-free by design.
 */
export function getPerformanceSummary(): PerformanceSummary {
  return {
    hasData: false,
    message:
      '📊 <b>Performance Summary:</b> Not available.\n' +
      'No verified trade records exist yet, so no trading statistics are shown.',
  }
}

/**
 * Telegram-ready section for /start, expiry and admin reports.
 * Same divider shape the old (fabricated) stats block used, so message
 * layouts are unchanged.
 */
export function formatPerformanceSection(): string {
  return `━━━━━━━━━━━━━━━━━━━

${getPerformanceSummary().message}

━━━━━━━━━━━━━━━━━━━`
}
