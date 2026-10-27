/**
 * Shared, fail-closed authentication helpers for HTTP endpoints.
 *
 * Added during security remediation:
 *  - [finding: unauthenticated_privileged_http_surface] gates /api/cron/*,
 *    /api/admin/* and the admin daily-stats report routes behind a
 *    CRON_SECRET bearer check (the check the README always claimed existed).
 *  - [finding: forgeable_telegram_admin_identity] gates the Telegram webhook
 *    behind Telegram's X-Telegram-Bot-Api-Secret-Token header.
 *
 * Both helpers FAIL CLOSED: when the expected secret is not configured the
 * request is rejected, even if it presents some token. Operators must set
 * CRON_SECRET / TELEGRAM_WEBHOOK_SECRET via `wrangler secret put`.
 */

const textEncoder = new TextEncoder()

/**
 * Length-safe, constant-time comparison of two strings.
 *
 * Compares UTF-8 bytes without early exit on the first mismatch; a length
 * difference is folded into the same accumulator so neither content nor
 * length leaks through timing.
 */
export function safeEqualStrings(a: string, b: string): boolean {
  const ab = textEncoder.encode(a)
  const bb = textEncoder.encode(b)
  const max = Math.max(ab.length, bb.length)
  let diff = ab.length ^ bb.length
  for (let i = 0; i < max; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

/**
 * Gate for /api/cron/*, /api/admin/* and admin report endpoints.
 * Requires `Authorization: Bearer <CRON_SECRET>`; rejects when the env var is
 * unset or the token mismatches.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const token = extractBearerToken(request)
  if (!token) return false
  return safeEqualStrings(token, expected)
}

/**
 * Gate for the Telegram webhook. Telegram includes the secret configured via
 * `setWebhook`'s `secret_token` parameter in the
 * `X-Telegram-Bot-Api-Secret-Token` header on every update it delivers.
 */
export function isAuthorizedTelegramWebhook(request: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!expected) return false
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
  if (!provided) return false
  return safeEqualStrings(provided, expected)
}
