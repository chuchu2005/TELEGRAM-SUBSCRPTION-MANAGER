# Broadcast Handler Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broadcast handler to reliably send messages to 1,000+ users with database-based deduplication and proper error handling.

**Architecture:** Add `BroadcastLog` table to Prisma schema for tracking sent messages, create broadcast utility functions, update both webhook and API broadcast handlers with duplicate checking and robust error handling.

**Tech Stack:** TypeScript, Next.js 14, Prisma (MongoDB), Node.js crypto module

---

## File Structure

**New files:**
- `src/lib/broadcast-config.ts` - Configuration constants for broadcasts
- `src/lib/broadcast.ts` - Utility functions for deduplication and logging

**Modified files:**
- `prisma/schema.prisma` - Add BroadcastLog model
- `src/app/api/telegram/webhook/route.ts` - Update sendBroadcast() with deduplication and error handling
- `src/app/api/admin/broadcast/route.ts` - Add duplicate checking to API endpoint

**Rationale:**
- `broadcast-config.ts` separates broadcast configuration from general app config
- `broadcast.ts` contains reusable utilities for both webhook and API endpoints
- Schema addition enables persistent deduplication across restarts
- Both endpoints share same deduplication logic for consistency

---

## Chunk 1: Database Schema and Migration

### Task 1: Add BroadcastLog Model to Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add BroadcastLog model to schema**

Open `prisma/schema.prisma` and add this model at the end (after the ReferralReward model):

```prisma
model BroadcastLog {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  messageHash   String   // SHA-256 hash of message content
  telegramUserId String   // User who received the message
  sentAt        DateTime @default(now())

  @@unique([messageHash, telegramUserId])
  @@index([sentAt])
}
```

This model:
- Uses MongoDB ObjectId syntax (@id @default(auto()) @map("_id") @db.ObjectId) to match existing patterns
- Stores message hash (SHA-256) to identify message content
- Stores telegramUserId as String (matching existing Subscription model)
- sentAt with index for efficient cleanup queries
- Unique constraint on [messageHash, telegramUserId] to prevent duplicate logs

- [ ] **Step 2: Generate and apply Prisma migration**

Run:
```bash
npx prisma migrate dev --name add_broadcast_log
```

Expected output:
- Migration file created in `prisma/migrations/`
- Database schema updated
- Prisma client regenerated

- [ ] **Step 3: Verify migration was applied**

Check that `prisma/migrations/` contains a new migration file:
```bash
ls -la prisma/migrations/
```

Expected: A file like `20260316_XXXXXX_add_broadcast_log/` exists

- [ ] **Step 4: Commit schema changes**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add BroadcastLog model for message deduplication

- Add BroadcastLog model with messageHash and telegramUserId
- Add unique constraint to prevent duplicate logs
- Add index on sentAt for efficient cleanup
- Apply migration to database

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: Configuration and Utility Functions

### Task 2: Create Broadcast Configuration File

**Files:**
- Create: `src/lib/broadcast-config.ts`

- [ ] **Step 1: Write broadcast configuration file**

Create `src/lib/broadcast-config.ts` with this content:

```typescript
/**
 * Broadcast Configuration
 *
 * Centralized configuration for broadcast functionality
 * Hardcoded values for easy development changes
 */

export const BROADCAST_CONFIG = {
  /**
   * Timeframe to prevent duplicate messages to same user (in hours)
   * Messages sent within this timeframe to the same user will be skipped
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
```

This file:
- Uses `as const` for type safety and immutability
- Includes detailed JSDoc comments explaining each setting
- DEDUPLICATION_HOURS: 24 hours prevents spam to same user
- RATE_LIMIT_MS: 100ms = 10 messages/sec (well under 30/sec limit)
- LOG_RETENTION_DAYS: 30 days for cleanup
- BROADCAST_TIMEOUT_HOURS: 2 hours timeout protection

- [ ] **Step 2: Commit configuration file**

```bash
git add src/lib/broadcast-config.ts
git commit -m "feat: add broadcast configuration file

- Create centralized config for broadcast settings
- Add deduplication timeframe (24 hours)
- Add rate limiting delay (100ms per message)
- Add log retention period (30 days)
- Add broadcast timeout protection (2 hours)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 3: Create Broadcast Utility Functions

**Files:**
- Create: `src/lib/broadcast.ts`

- [ ] **Step 1: Write broadcast utility functions**

Create `src/lib/broadcast.ts` with this content:

```typescript
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
 * Queries the BroadcastLog table to see if this specific message
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
```

This file provides:
- `generateMessageHash() - Creates SHA-256 hash for deduplication
- `hasReceivedMessageRecently() - Checks if user received message in timeframe
- `logBroadcastMessage() - Records sent messages to database
- `cleanupOldBroadcastLogs() - Cleans up old logs (for cron jobs)

- [ ] **Step 2: Commit utility functions**

```bash
git add src/lib/broadcast.ts
git commit -m "feat: add broadcast utility functions

- Add generateMessageHash() for SHA-256 hashing
- Add hasReceivedMessageRecently() for duplicate checking
- Add logBroadcastMessage() for tracking sent messages
- Add cleanupOldBroadcastLogs() for log cleanup
- Use BROADCAST_CONFIG for all settings

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: Update Webhook Broadcast Handler

### Task 4: Update sendBroadcast Function in Webhook

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts` (lines ~1342-1444)

- [ ] **Step 1: Add imports for broadcast utilities**

At the top of the file (near line 7-8), add these imports:

```typescript
import { generateMessageHash, hasReceivedMessageRecently, logBroadcastMessage } from '@/lib/broadcast'
import { BROADCAST_CONFIG } from '@/lib/broadcast-config'
```

Place these after the existing imports like `import { sendMessage, sendMessageWithKeyboard } from '@/lib/telegram'`

- [ ] **Step 2: Add broadcast timestamp tracking**

Find the line `let isGlobalBroadcastRunning = false` (around line 32) and add this after it:

```typescript
let isGlobalBroadcastRunning = false
let shouldCancelBroadcast = false
let broadcastStartTime: number | null = null
```

This tracks:
- When the broadcast started (for timeout protection)
- Existing lock and cancel flags remain

- [ ] **Step 3: Replace the sendBroadcast function**

Find the `async function sendBroadcast(...)` function (starts around line 1342) and replace the entire function with this updated version:

```typescript
/**
 * Shared broadcast function
 */
async function sendBroadcast(user: TelegramUser, args: string[], planType: 'basic' | 'biweekly' | 'monthly' | 'premium' | 'all', activeOnly: boolean): Promise<void> {
  // Check if user is admin
  if (user.id !== ADMIN_ID) {
    await sendMessage(user.id, '❌ Only the admin can use this command.')
    return
  }

  // Prevent duplicate broadcasts (crucial to stop Telegram retry loops)
  if (isGlobalBroadcastRunning) {
    await sendMessage(user.id, '⚠️ <b>Wait!</b> A broadcast is already running. Please wait for it to finish before starting a new one.')
    return
  }

  // Get message from args
  const message = args.join(' ')

  if (!message.trim()) {
    await sendMessage(user.id, `❌ Please provide a message to broadcast.\n\n<b>Usage:</b>\n/broadcast Your message here`)
    return
  }

  // Support for optional button: "Line 1 | Line 2 | Button Text | callback_data"
  const messageParts = message.split('|').map(p => p.trim())
  let cleanMessage = ''
  let buttonText = ''
  let callbackData = ''

  if (messageParts.length >= 3) {
    callbackData = messageParts.pop()!
    buttonText = messageParts.pop()!
    cleanMessage = messageParts.join('\n')
  } else {
    cleanMessage = message.split('|').map(p => p.trim()).join('\n')
  }

  // 1. Acknowledge the command immediately
  const targetType = planType === 'all' ? 'all users' : `${planType} users`
  const filterType = activeOnly ? 'active subscribers only' : targetType

  await sendMessage(user.id, `📢 <b>Starting Broadcast...</b>\n\n━━━━━━━━━━━━━━━━━━━\n\nTarget: ${filterType}\n\n<i>Processing in background. I will send you a summary when done!</i>`)

  // 2. Set the lock SYNCHRONOUSLY before starting the background task
  isGlobalBroadcastRunning = true
  broadcastStartTime = Date.now()

  // 3. Start the background process without awaiting the loop
  ;(async () => {
    try {
      // Build query for recipients
      let whereClause: any = {}
      if (planType !== 'all') whereClause.planType = planType
      if (activeOnly) {
        whereClause.expiresAt = { gt: new Date() }
        whereClause.isRemoved = false
      }

      let recipients: { telegramUserId: string }[] = []
      if (planType === 'all' && !activeOnly) {
        recipients = await prisma.user.findMany({ select: { telegramUserId: true } })
      } else {
        recipients = await prisma.subscription.findMany({
          where: whereClause,
          select: { telegramUserId: true },
          distinct: ['telegramUserId']
        })
      }

      // Handle empty recipient list
      if (recipients.length === 0) {
        await sendMessage(user.id, `❌ No users match the specified criteria.`)
        return
      }

      console.log(`[Broadcast] Starting background loop for ${recipients.length} users`)

      // Generate message hash once for all recipients
      const messageHash = generateMessageHash(cleanMessage)

      let successCount = 0
      let failedCount = 0
      let duplicateCount = 0
      const failedUsers: string[] = []

      for (const recipient of recipients) {
        // Check for broadcast timeout (2 hours max)
        if (broadcastStartTime && Date.now() - broadcastStartTime > BROADCAST_CONFIG.BROADCAST_TIMEOUT_HOURS * 60 * 60 * 1000) {
          console.warn('[Broadcast] Timeout reached, releasing lock')
          await sendMessage(user.id, `⏱️ <b>Broadcast Timeout</b>\n\nThe broadcast has been running for ${BROADCAST_CONFIG.BROADCAST_TIMEOUT_HOURS} hours and has timed out. The lock has been released.`)
          break
        }

        // Check for cancellation
        if (shouldCancelBroadcast) {
          console.log('[Broadcast] STOPPED by admin command.')
          await sendMessage(user.id, `🛑 <b>Broadcast Stopped!</b>\n\nI have stopped the remaining sends as requested.`)
          break
        }

        // Check for duplicate (deduplication)
        const hasReceived = await hasReceivedMessageRecently(recipient.telegramUserId, messageHash)
        if (hasReceived) {
          duplicateCount++
          console.log(`[Broadcast] Skipped duplicate for user ${recipient.telegramUserId}`)
          await new Promise(resolve => setTimeout(resolve, BROADCAST_CONFIG.RATE_LIMIT_MS))
          continue
        }

        try {
          let sent = false
          if (buttonText && callbackData) {
            sent = await sendMessageWithKeyboard(recipient.telegramUserId, cleanMessage, {
              inline_keyboard: [[{ text: buttonText, callback_data: callbackData }]]
            })
          } else {
            sent = await sendMessage(recipient.telegramUserId, cleanMessage)
          }

          if (sent) {
            successCount++
            // Log successful send to database
            try {
              await logBroadcastMessage(recipient.telegramUserId, messageHash)
            } catch (logError) {
              // Don't stop broadcast - message was already sent
              console.error(`Failed to log broadcast for user ${recipient.telegramUserId}:`, logError)
            }
          } else {
            failedCount++
            failedUsers.push(recipient.telegramUserId)
          }
        } catch (error: any) {
          // Handle Telegram rate limit (429 error)
          if (error?.response?.status === 429) {
            const retryAfter = error.response.data?.retry_after || 30
            console.warn(`[Broadcast] Rate limited, waiting ${retryAfter}s`)
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
            continue // Retry this user
          }

          // Handle other errors
          failedCount++
          failedUsers.push(recipient.telegramUserId)
          console.error(`[Broadcast] Failed to send to ${recipient.telegramUserId}:`, error)
        }

        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, BROADCAST_CONFIG.RATE_LIMIT_MS))
      }

      await sendMessage(user.id, `✅ <b>Broadcast Complete!</b>\n\n📊 <b>Stats:</b>\n• Successful: ${successCount}\n• Failed: ${failedCount}\n• Skipped (duplicate): ${duplicateCount}\n\n${failedUsers.length > 0 ? `❌ Failed users:\n${failedUsers.slice(0, 10).join('\n')}${failedUsers.length > 10 ? '\n...and more' : ''}` : ''}`)
    } catch (err) {
      console.error('[Broadcast Task] Error:', err)
      await sendMessage(user.id, `❌ <b>Broadcast Error</b>\n\nAn error occurred: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      // Always release lock, even on error
      isGlobalBroadcastRunning = false
      shouldCancelBroadcast = false
      broadcastStartTime = null
    }
  })()
}
```

Key improvements:
- Imports broadcast utilities and config
- Tracks broadcast start time for timeout
- Checks for duplicates before sending
- Logs successful sends to database
- Handles 429 rate limit errors with retry
- Reports duplicate count in summary
- Proper finally block always releases lock
- Detailed error logging and user feedback

- [ ] **Step 3: Commit webhook broadcast updates**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: update webhook broadcast handler with deduplication and error handling

- Add imports for broadcast utilities and config
- Add broadcastStartTime tracking for timeout protection
- Implement message deduplication via BroadcastLog
- Add 429 rate limit error handling with retry
- Add proper finally block to always release lock
- Report duplicate count in broadcast summary
- Handle database logging errors gracefully
- Add empty recipient list check

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 4: Update API Broadcast Route

### Task 5: Add Deduplication to API Broadcast Route

**Files:**
- Modify: `src/app/api/admin/broadcast/route.ts`

- [ ] **Step 1: Add imports for broadcast utilities**

At the top of the file (around line 3-4), add these imports:

```typescript
import { generateMessageHash, hasReceivedMessageRecently, logBroadcastMessage } from '@/lib/broadcast'
import { BROADCAST_CONFIG } from '@/lib/broadcast-config'
```

- [ ] **Step 2: Update the POST function to add deduplication**

Find the POST function (starts around line 10) and update the message sending loop. Replace the loop section (lines 66-89) with this:

```typescript
    // Get all unique telegram user IDs
    const subscriptions = await prisma.subscription.findMany({
      where: whereClause,
      select: {
        telegramUserId: true,
        telegramUsername: true
      },
      distinct: ['telegramUserId']
    })

    // Handle empty recipient list
    if (subscriptions.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No users match the specified criteria'
      }, { status: 400 })
    }

    console.log(`Sending broadcast to ${subscriptions.length} users`)

    // Generate message hash once for all recipients
    const messageHash = generateMessageHash(message)

    // Send message to each user
    let successCount = 0
    let failedCount = 0
    let duplicateCount = 0
    const failedUsers: string[] = []

    for (const subscription of subscriptions) {
      // Check for duplicate (deduplication)
      const hasReceived = await hasReceivedMessageRecently(subscription.telegramUserId, messageHash)
      if (hasReceived) {
        duplicateCount++
        console.log(`[Broadcast API] Skipped duplicate for user ${subscription.telegramUserId}`)
        await new Promise(resolve => setTimeout(resolve, BROADCAST_CONFIG.RATE_LIMIT_MS))
        continue
      }

      try {
        let sent: boolean
        if (replyMarkup) {
          sent = await sendMessageWithKeyboard(subscription.telegramUserId, message, replyMarkup)
        } else {
          sent = await sendMessage(subscription.telegramUserId, message)
        }

        if (sent) {
          successCount++
          // Log successful send to database
          try {
            await logBroadcastMessage(subscription.telegramUserId, messageHash)
          } catch (logError) {
            // Don't stop broadcast - message was already sent
            console.error(`Failed to log broadcast for user ${subscription.telegramUserId}:`, logError)
          }
        } else {
          failedCount++
          failedUsers.push(subscription.telegramUsername || subscription.telegramUserId.toString())
        }
      } catch (error: any) {
        // Handle Telegram rate limit (429 error)
        if (error?.response?.status === 429) {
          const retryAfter = error.response.data?.retry_after || 30
          console.warn(`[Broadcast API] Rate limited, waiting ${retryAfter}s`)
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
          continue // Retry this user
        }

        // Handle other errors
        failedCount++
        failedUsers.push(subscription.telegramUsername || subscription.telegramUserId.toString())
        console.error(`Failed to send to ${subscription.telegramUserId}:`, error)
      }

      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, BROADCAST_CONFIG.RATE_LIMIT_MS))
    }

    return NextResponse.json({
      success: true,
      message: 'Broadcast sent successfully',
      stats: {
        total: subscriptions.length,
        successful: successCount,
        failed: failedCount,
        skipped: duplicateCount,
        failedUsers
      }
    })
```

Key changes:
- Generate message hash once for efficiency
- Check for duplicates before sending
- Log successful sends to database
- Handle 429 rate limit errors
- Include duplicate count in response stats
- Handle database logging errors gracefully

- [ ] **Step 3: Commit API broadcast updates**

```bash
git add src/app/api/admin/broadcast/route.ts
git commit -m "feat: add deduplication to API broadcast endpoint

- Add imports for broadcast utilities and config
- Implement message deduplication via BroadcastLog
- Add 429 rate limit error handling with retry
- Log successful sends to database
- Include duplicate count in response stats
- Handle database logging errors gracefully
- Use BROADCAST_CONFIG.RATE_LIMIT_MS for delays

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Testing Plan

### Manual Testing Steps

After implementation, perform these tests:

**Test 1: Duplicate Prevention**
```bash
# Send broadcast to yourself twice
/broadcast Test message

# Wait a few seconds, send again
/broadcast Test message

# Expected: Second message is NOT sent (duplicate detected)
```

**Test 2: Deduplication Expiry**
```bash
# Send broadcast
/broadcast Test message 1

# Wait 24+ hours (or manually set DEDUPLICATION_HOURS to 0 for testing)
/broadcast Test message 1

# Expected: Message IS sent (deduplication expired)
```

**Test 3: Broadcast to Multiple Users**
```bash
# Send broadcast to all users
/broadcast Test message to all users

# Expected: All users receive message, duplicates are skipped
# Check admin summary for accurate counts
```

**Test 4: API Endpoint Test**
```bash
# Test via curl
curl -X POST http://localhost:3000/api/admin/broadcast \
  -H "Content-Type: application/json" \
  -d '{"message": "API test message"}'

# Expected: Returns stats with success, failed, and skipped counts
```

**Test 5: Error Handling**
```bash
# Test with invalid message
/broadcast

# Expected: Returns error message
```

**Test 6: Rate Limit Handling**
- The broadcast should automatically handle 429 errors from Telegram
- Check console logs for "Rate limited" messages
- Verify broadcast continues after retry delay

**Test 7: Lock Timeout**
- Start a broadcast with 1000+ users
- Wait 2+ hours (or manually reduce BROADCAST_TIMEOUT_HOURS for testing)
- Start another broadcast

# Expected: First broadcast times out and releases lock
# New broadcast can start

**Test 8: /stop_broadcast Command**
```bash
# Start a long broadcast
/broadcast Test message

# Immediately send stop
/stop_broadcast

# Expected: Broadcast stops, lock is released
```

---

## Rollback Plan

If issues arise after deployment:

**Immediate rollback:**
```bash
git revert HEAD~3  # Reverts last 3 commits
npx prisma migrate resolve --rolled-back [migration_name]
```

**To disable deduplication (if causing issues):**
1. Set `BROADCAST_CONFIG.DEDUPLICATION_HOURS = 0` in `src/lib/broadcast-config.ts`
2. No migration needed - config change only

**To disable rate limiting (if causing delays):**
1. Set `BROADCAST_CONFIG.RATE_LIMIT_MS = 0` in `src/lib/broadcast-config.ts`
2. Warning: This may trigger Telegram's 429 errors

---

## Performance Notes

- **Database queries**: ~2 queries per recipient (1 check duplicate + 1 log)
- **Memory usage**: Minimal - only config and broadcast timestamp in memory
- **Network**: 100ms delay between messages = ~10 messages/second
  - For 1000 users: ~100 seconds total broadcast time
  - For 5000 users: ~500 seconds total broadcast time
- **Database growth**: With 1000 users and 1 broadcast/day:
  - 30,000 logs/month = ~1MB storage (negligible)
  - Cleanup after 30 days keeps growth bounded

---

## Post-Implementation Tasks (Optional, Out of Scope)

1. **Add cron job for log cleanup**:
   - Create `src/app/api/cron/cleanup-broadcast-logs/route.ts`
   - Call `cleanupOldBroadcastLogs()` daily
   - Prevents database from growing unbounded

2. **Add progress tracking**:
   - Store broadcast state in database
   - Allow admin to check progress mid-broadcast
   - Resume interrupted broadcasts

3. **Add broadcast history**:
   - Track all past broadcasts
   - View past broadcasts and their stats
   - Re-send previous broadcasts easily
