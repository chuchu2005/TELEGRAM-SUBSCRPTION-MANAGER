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
