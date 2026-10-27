import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    subscription: {
      findFirst: vi.fn(async () => null),
    },
  },
}))

import { POST } from '@/app/api/payment/link/route'

const RESTORE = { ...process.env }

beforeEach(() => {
  vi.unstubAllGlobals()
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy_placeholder'
})

afterEach(() => {
  process.env = { ...RESTORE }
  vi.unstubAllGlobals()
})

const paystackOk = {
  ok: true,
  status: 200,
  json: async () => ({
    status: true,
    message: 'Authorization created',
    data: {
      authorization_url: 'https://checkout.paystack.com/test_ref',
      access_code: 'ac_test',
      reference: 'ref_test_1',
    },
  }),
}

function callRoute(body: unknown) {
  return POST(new Request('http://localhost/api/payment/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest)
}

function stubPaystack() {
  const fetchMock = vi.fn(async () => paystackOk)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const paystackPayload = (fetchMock: { mock: { calls: unknown[][] } }) =>
  JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as {
    amount: number
    metadata: Record<string, unknown>
  }

describe('POST /api/payment/link [finding: paid_promo_billing_defect]', () => {
  it('prices a known plan from PLANS when no amountKobo is given', async () => {
    const fetchMock = stubPaystack()
    const res = await callRoute({ telegramId: '42', planType: 'monthly' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(paystackPayload(fetchMock).amount).toBe(1800000) // PLANS.monthly
  })

  it('passes a caller-supplied amountKobo straight into the Paystack payload', async () => {
    const fetchMock = stubPaystack()
    const res = await callRoute({
      telegramId: '42',
      planType: 'basic',
      amountKobo: 123456,
      metadata: { promoCode: 'PROMO1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.amount).toBe(123456)
    const payload = paystackPayload(fetchMock)
    expect(payload.amount).toBe(123456)
    expect(payload.metadata.promoCode).toBe('PROMO1')
    expect(payload.metadata.plan_type).toBe('basic')
  })

  it("no longer throws on 'custom' plan types when an amount is supplied", async () => {
    const fetchMock = stubPaystack()
    const res = await callRoute({
      telegramId: '42',
      planType: 'custom',
      amountKobo: 999,
      metadata: { promoCode: 'CUST', customPromoId: 'abc' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    const payload = paystackPayload(fetchMock)
    expect(payload.amount).toBe(999)
    expect(payload.metadata.plan_type).toBe('custom')
    expect(payload.metadata.promoCode).toBe('CUST')
  })

  it("rejects 'custom' without an amountKobo with a clear 400 (was a thrown 500)", async () => {
    stubPaystack()
    const res = await callRoute({ telegramId: '42', planType: 'custom' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/amountKobo|custom/i)
  })

  it('rejects an unknown plan type with a clear 400 listing valid plans', async () => {
    stubPaystack()
    const res = await callRoute({ telegramId: '42', planType: 'nonsense' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/unknown plan type/i)
    expect(body.error).toMatch(/basic/)
  })

  it.each([0, -5, 1.5, '999'])('rejects invalid amountKobo %s with 400', async (bad) => {
    stubPaystack()
    const res = await callRoute({ telegramId: '42', planType: 'basic', amountKobo: bad })
    expect(res.status).toBe(400)
  })
})
