import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isAuthorizedCronRequest,
  isAuthorizedTelegramWebhook,
  safeEqualStrings,
} from '@/lib/api-auth'

const RESTORE = { ...process.env }

beforeEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.TELEGRAM_WEBHOOK_SECRET
})

afterEach(() => {
  process.env = { ...RESTORE }
})

describe('safeEqualStrings', () => {
  it('matches equal strings', () => {
    expect(safeEqualStrings('abc', 'abc')).toBe(true)
  })

  it('rejects different strings of the same length', () => {
    expect(safeEqualStrings('abc', 'abd')).toBe(false)
  })

  it('rejects different lengths', () => {
    expect(safeEqualStrings('abc', 'abcd')).toBe(false)
    expect(safeEqualStrings('', 'x')).toBe(false)
  })

  it('accepts two empty strings', () => {
    expect(safeEqualStrings('', '')).toBe(true)
  })
})

describe('isAuthorizedCronRequest', () => {
  const req = (authorization?: string) =>
    new Request('http://localhost/api/cron/x', {
      method: 'GET',
      headers: authorization ? { authorization } : {},
    })

  it('fails closed when CRON_SECRET is unset, even with a token', () => {
    expect(isAuthorizedCronRequest(req('Bearer whatever'))).toBe(false)
  })

  it('accepts the matching bearer token', () => {
    process.env.CRON_SECRET = 'test-cron-secret'
    expect(isAuthorizedCronRequest(req('Bearer test-cron-secret'))).toBe(true)
  })

  it('rejects a wrong bearer token', () => {
    process.env.CRON_SECRET = 'test-cron-secret'
    expect(isAuthorizedCronRequest(req('Bearer wrong'))).toBe(false)
  })

  it('rejects a missing Authorization header', () => {
    process.env.CRON_SECRET = 'test-cron-secret'
    expect(isAuthorizedCronRequest(req())).toBe(false)
  })

  it('rejects non-bearer Authorization schemes', () => {
    process.env.CRON_SECRET = 'test-cron-secret'
    expect(isAuthorizedCronRequest(req('Basic dXNlcjpwYXNz'))).toBe(false)
  })
})

describe('isAuthorizedTelegramWebhook', () => {
  const req = (secretToken?: string) =>
    new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: secretToken ? { 'x-telegram-bot-api-secret-token': secretToken } : {},
    })

  it('fails closed when TELEGRAM_WEBHOOK_SECRET is unset', () => {
    expect(isAuthorizedTelegramWebhook(req('whatever'))).toBe(false)
  })

  it('accepts the matching secret token', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret'
    expect(isAuthorizedTelegramWebhook(req('test-webhook-secret'))).toBe(true)
  })

  it('rejects a wrong secret token', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret'
    expect(isAuthorizedTelegramWebhook(req('wrong'))).toBe(false)
  })

  it('rejects a missing header', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret'
    expect(isAuthorizedTelegramWebhook(req())).toBe(false)
  })
})
