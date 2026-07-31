import { createHash } from 'crypto'
import { BROADCAST_CONFIG } from './broadcast-config'
import { prisma } from './prisma'

/**
 * Generate SHA-256 hash of message content
 *
 * This hash is used to identify message content for deduplication.
 * Same message content will always produce the same hash.
 *
 * @param message - The message content to hash
 * @returns SHA-256 hash as hex string
 */
export function generateMessageHash(message: string): string {
  return createHash('sha256').update(message).digest('hex')
}

/**
 * Check if user has received this message within deduplication timeframe
 *
 * Queries BroadcastLog table to see if this specific message
 * was sent to this user recently.
 *
 * @param telegramUserId - The user's Telegram ID
 * @param messageHash - The hash of the message to check
 * @returns true if message was sent recently, false otherwise
 */
export async function hasReceivedMessageRecently(
  telegramUserId: string,
  messageHash: string
): Promise<boolean> {
  const cutoff = new Date(
    Date.now() - BROADCAST_CONFIG.DEDUPLICATION_HOURS * 60 * 60 * 1000
  )

  const log = await prisma.broadcastLog.findFirst({
    where: {
      messageHash,
      telegramUserId,
      sentAt: { gte: cutoff }
    }
  })

  return !!log
}

/**
 * Log a successfully sent broadcast message
 *
 * Records that a specific message was sent to a specific user.
 * Logs are used for future deduplication checks.
 *
 * @param telegramUserId - The user who received the message
 * @param messageHash - The hash of the sent message
 */
export async function logBroadcastMessage(
  telegramUserId: string,
  messageHash: string
): Promise<void> {
  await prisma.broadcastLog.create({
    data: {
      telegramUserId,
      messageHash
    }
  })
}

/**
 * Clean up old broadcast logs
 *
 * Deletes broadcast logs older than the retention period.
 * Should be called periodically (e.g., via cron job).
 *
 * @returns Number of logs deleted
 */
export async function cleanupOldBroadcastLogs(): Promise<number> {
  const cutoff = new Date(
    Date.now() - BROADCAST_CONFIG.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
  )

  const result = await prisma.broadcastLog.deleteMany({
    where: { sentAt: { lt: cutoff } }
  })

  return result.count
}

/**
 * Run an async worker over a list with bounded concurrency.
 *
 * This replaces the sequential `for (...) { await sendMessage(...); setTimeout(100) }`
 * loops used by the broadcast paths. Those loops breach Cloudflare Workers limits
 * on large recipient lists: the per-message sleep serializes everything (wall-clock
 * = N * ~100ms+), and N outbound subrequests can exceed the per-request cap.
 *
 * Here, `concurrency` workers pull from a shared index, so sends run in parallel up
 * to the cap with NO artificial sleep — fast enough to finish a typical list well
 * inside a single Worker invocation. The worker is responsible for its own error
 * handling and bookkeeping (counts); a throwing worker is swallowed so one bad
 * recipient cannot abort the whole batch.
 *
 * @param items - Recipients (or any list) to process.
 * @param worker - Async callback per item. Return void; track counts in the caller.
 * @param concurrency - Max in-flight calls (default 8). Telegram allows ~30 msg/s
 *   to distinct chats, so 8 concurrent keeps us safely under rate limits.
 */
export async function runBounded<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency = 8
): Promise<void> {
  if (items.length === 0) return

  let index = 0
  const limit = Math.min(concurrency, items.length)

  async function runner(): Promise<void> {
    while (index < items.length) {
      const my = index++
      try {
        await worker(items[my], my)
      } catch (err) {
        // A single failure must not break the rest of the batch.
        console.error('[runBounded] worker error:', err)
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runner()))
}
