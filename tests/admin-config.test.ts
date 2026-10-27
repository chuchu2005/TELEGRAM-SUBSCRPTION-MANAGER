import { afterEach, describe, expect, it } from 'vitest'

const RESTORE = { ...process.env }

afterEach(() => {
  process.env = { ...RESTORE }
})

describe('getAdminId [finding: forgeable_telegram_admin_identity]', () => {
  it('resolves from ADMIN_TELEGRAM_ID when set', async () => {
    process.env.ADMIN_TELEGRAM_ID = '999888777'
    const { getAdminId } = await import('@/lib/config')
    expect(getAdminId()).toBe(999888777)
  })

  it('uses the documented dev fallback outside production when unset', async () => {
    delete process.env.ADMIN_TELEGRAM_ID
    const { getAdminId, DEV_FALLBACK_ADMIN_TELEGRAM_ID } = await import('@/lib/config')
    expect(getAdminId()).toBe(DEV_FALLBACK_ADMIN_TELEGRAM_ID)
  })

  it('ignores a non-numeric ADMIN_TELEGRAM_ID', async () => {
    process.env.ADMIN_TELEGRAM_ID = 'not-a-number'
    const { getAdminId, DEV_FALLBACK_ADMIN_TELEGRAM_ID } = await import('@/lib/config')
    expect(getAdminId()).toBe(DEV_FALLBACK_ADMIN_TELEGRAM_ID)
  })

  it('throws (fail closed) in production when unset', async () => {
    delete process.env.ADMIN_TELEGRAM_ID
    Object.assign(process.env, { NODE_ENV: 'production' })
    const { getAdminId } = await import('@/lib/config')
    expect(() => getAdminId()).toThrow(/ADMIN_TELEGRAM_ID/)
  })

  it('works in production when set', async () => {
    process.env.ADMIN_TELEGRAM_ID = '12345'
    Object.assign(process.env, { NODE_ENV: 'production' })
    const { getAdminId } = await import('@/lib/config')
    expect(getAdminId()).toBe(12345)
  })
})
