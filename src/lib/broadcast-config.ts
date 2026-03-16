/**
 * Broadcast Configuration
 *
 * Centralized configuration for broadcast functionality
 * Hardcoded values for easy development changes
 */

export const BROADCAST_CONFIG = {
  /**
   * Timeframe to prevent duplicate messages to same user (in hours)
   * Messages sent within this timeframe to => same user will be skipped
   */
  DEDUPLICATION_HOURS: 24,

  /**
   * Delay between messages to respect Telegram rate limits (in milliseconds)
   * Telegram limit: ~30 messages/second to different users
   * 100ms = 10 messages/second (safe margin with headroom)
   */
  RATE_LIMIT_MS: 100,

  /**
   * Maximum time to keep old broadcast logs (in days)
   * Logs older than this will be cleaned up periodically
   */
  LOG_RETENTION_DAYS: 30,

  /**
   * Maximum time a broadcast can run before auto-releasing lock (in hours)
   * Prevents stuck locks from blocking new broadcasts indefinitely
   */
  BROADCAST_TIMEOUT_HOURS: 2
} as const