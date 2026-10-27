import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      upsert: vi.fn(async () => ({})),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
    },
  },
}))

vi.mock('@/lib/telegram', () => ({
  sendMessage: vi.fn(async () => true),
  sendMessageWithKeyboard: vi.fn(async () => true),
  sendPhoto: vi.fn(async () => true),
  createInviteLink: vi.fn(async () => 'https://t.me/+test-invite'),
  formatDate: (d: Date) => new Date(d).toISOString(),
  getDaysRemaining: () => 3,
  banChatMember: vi.fn(async () => true),
  unbanChatMember: vi.fn(async () => true),
  answerCallbackQuery: vi.fn(async () => true),
  editMessageText: vi.fn(async () => true),
  getChatMember: vi.fn(async () => ({ status: 'member' })),
}))

import { POST } from '@/app/api/telegram/webhook/route'

const RESTORE = { ...process.env }

beforeEach(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret'
})

afterEach(() => {
  process.env = { ...RESTORE }
})

const req = (init: { secretToken?: string; body?: string } = {}) =>
  new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: {
      ...(init.secretToken ? { 'x-telegram-bot-api-secret-token': init.secretToken } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body,
  }) as unknown as NextRequest

// A valid callback_query update whose data matches no handler: after the user
// upsert and callback answer it falls through to the early `{ ok: true }`
// return, so a 200 proves the update was processed past the auth gate.
const noopUpdate = JSON.stringify({
  update_id: 1,
  callback_query: {
    id: 'cb-test',
    from: { id: 123456789, is_bot: false, first_name: 'Test' },
    message: { message_id: 1, chat: { id: 123456789 }, date: 0 },
    data: '__dd_noop__',
  },
})

describe('Telegram webhook secret-token gate [finding: forgeable_telegram_admin_identity]', () => {
  it('returns 401 with no secret-token header and never parses the body', async () => {
    const res = await POST(req({})) // no body at all — must not reach request.json()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 401 with a wrong secret token', async () => {
    const res = await POST(req({ secretToken: 'wrong', body: noopUpdate }))
    expect(res.status).toBe(401)
  })

  it('fails closed when TELEGRAM_WEBHOOK_SECRET is unset', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    const res = await POST(req({ secretToken: 'whatever', body: noopUpdate }))
    expect(res.status).toBe(401)
  })

  it('processes an update (200 ok) when the secret token matches', async () => {
    const res = await POST(req({ secretToken: 'test-webhook-secret', body: noopUpdate }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
