import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Route handlers are exercised directly (no HTTP server). Anything they touch
// past the auth gate gets an inert mock so a request that reaches business
// logic cannot hit a real database or Telegram API.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    subscription: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
    referral: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    referralReward: {
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
    },
    user: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
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

import { GET as removeExpiredGET } from '@/app/api/cron/remove-expired/route'
import { GET as sendBroadcastGET } from '@/app/api/cron/send-broadcast/route'
import { GET as sendRemindersGET } from '@/app/api/cron/send-reminders/route'
import { GET as sendReferralStatsGET } from '@/app/api/cron/send-referral-stats/route'
import { GET as adminBroadcastGET, POST as adminBroadcastPOST } from '@/app/api/admin/broadcast/route'
import { GET as dailyStatsGET, POST as dailyStatsPOST } from '@/app/api/daily-stats/route'

const RESTORE = { ...process.env }

beforeEach(() => {
  process.env.CRON_SECRET = 'test-cron-secret'
})

afterEach(() => {
  process.env = { ...RESTORE }
})

const req = (init: { auth?: string; method?: string; body?: string } = {}) =>
  new Request('http://localhost/api/cron/test', {
    method: init.method ?? 'GET',
    headers: {
      ...(init.auth ? { authorization: init.auth } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body,
  }) as unknown as NextRequest

const CRON_ROUTES: Array<[string, (r: NextRequest) => Promise<Response>]> = [
  ['GET /api/cron/remove-expired', removeExpiredGET],
  ['GET /api/cron/send-broadcast', sendBroadcastGET],
  ['GET /api/cron/send-reminders', sendRemindersGET],
  ['GET /api/cron/send-referral-stats', sendReferralStatsGET],
  ['GET /api/admin/broadcast', adminBroadcastGET],
  ['POST /api/admin/broadcast', adminBroadcastPOST],
  ['GET /api/daily-stats', dailyStatsGET],
  ['POST /api/daily-stats', dailyStatsPOST],
]

describe('cron/admin route authentication [finding: unauthenticated_privileged_http_surface]', () => {
  it.each(CRON_ROUTES)('%s returns 401 with no Authorization header', async (_name, handler) => {
    const res = await handler(req({}))
    expect(res.status).toBe(401)
  })

  it.each(CRON_ROUTES)('%s returns 401 with a wrong bearer token', async (_name, handler) => {
    const res = await handler(req({ auth: 'Bearer not-the-secret' }))
    expect(res.status).toBe(401)
  })

  it.each(CRON_ROUTES)('%s returns 401 (fail closed) when CRON_SECRET is unset', async (_name, handler) => {
    delete process.env.CRON_SECRET
    const res = await handler(req({ auth: 'Bearer anything' }))
    expect(res.status).toBe(401)
  })

  it('lets an authenticated cron route run through to its handler (200)', async () => {
    const res = await sendReferralStatsGET(req({ auth: 'Bearer test-cron-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
