# Broadcast Handler Design Spec

**Date:** 2026-03-16
**Status:** Approved
**Approach:** Database-Based Deduplication + Improved Error Handling

---

## Problem Statement

The current broadcast handler has several issues:

1. **Messages not being sent** - Background async task (IIFE) may fail silently without proper error handling
2. **Lock mechanism issues** - `isGlobalBroadcastRunning` flag may never be released if errors occur
3. **No duplicate prevention** - Same message can be sent to same user multiple times
4. **Poor error handling** - Errors in background task don't release locks or provide feedback
5. **No progress tracking** - Admin receives no status updates during long broadcasts

---

## Requirements

- Support 1,000+ broadcast recipients
- Basic reliability (some failures acceptable)
- Prevent duplicate messages to same user within configurable timeframe
- No additional infrastructure (use existing Prisma/PostgreSQL)
- Fix current bug where messages don't send

---

## Architecture

### Database Schema Addition

**New table: `BroadcastLog`**

```prisma
model BroadcastLog {
  id            String   @id @default(cuid())
  messageHash   String   // SHA-256 hash of message content
  telegramUserId String   // User who received the message
  sentAt        DateTime @default(now())

  @@unique([messageHash, telegramUserId])
  @@index([sentAt])
}
```

**Rationale:**
- `messageHash` - Identifies message content (prevents sending duplicate content)
- `telegramUserId` - Tracks which user received it
- `sentAt` - Enables timeframe-based deduplication
- Unique constraint - Ensures one log per message/user combination
- Index on sentAt - Enables efficient cleanup of old logs

### Broadcast Flow

```
1. Admin sends /broadcast "Message"
   ↓
2. Check if broadcast already running (prevent concurrent broadcasts)
   ↓
3. Generate SHA-256 hash of message content
   ↓
4. Get recipients based on plan type and active-only filters
   ↓
5. For each recipient:
   - Check if message_hash + user_id exists within deduplication timeframe
   - If yes: skip (duplicate detected)
   - If no: send message → log to database
   - Wait 100ms (rate limit)
   ↓
6. Send summary to admin with stats
   ↓
7. Release broadcast lock
```

---

## Components

### 1. Configuration File

**File:** `src/lib/broadcast-config.ts`

```typescript
export const BROADCAST_CONFIG = {
  // Timeframe to prevent duplicate messages to same user (in hours)
  DEDUPLICATION_HOURS: 24,

  // Delay between messages to respect Telegram rate limits (in milliseconds)
  // Telegram limit: ~30 messages/second
  // 100ms = 10 messages/second (safe margin)
  RATE_LIMIT_MS: 100,

  // Maximum time to keep old broadcast logs (in days)
  LOG_RETENTION_DAYS: 30
}
```

**Why hardcode in config file:**
- Easier to change during development
- No server restart needed for config changes
- Clear visibility of all broadcast settings
- Simpler deployment

### 2. Broadcast Utility Functions

**File:** `src/lib/broadcast.ts` (new file)

```typescript
import { createHash } from 'crypto'
import { BROADCAST_CONFIG } from './broadcast-config'
import { prisma } from './prisma'

/**
 * Generate SHA-256 hash of message content
 */
export function generateMessageHash(message: string): string {
  return createHash('sha256').update(message).digest('hex')
}

/**
 * Check if user has received this message within deduplication timeframe
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
 * Clean up old broadcast logs (should be called periodically)
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

### 3. Updated sendBroadcast Function

**File:** `src/app/api/telegram/webhook/route.ts`

Key changes:
- Import new utilities and config
- Wrap entire background task in try/catch/finally
- Always release `isGlobalBroadcastRunning` lock (even on errors)
- Check duplicates before sending each message
- Log successful sends to database
- Better error logging and user feedback

### 4. API Broadcast Route

**File:** `src/app/api/admin/broadcast/route.ts`

Add same duplicate checking logic to maintain consistency with webhook implementation.

---

## Edge Case Handling

### 1. Database Errors During Logging

```typescript
try {
  await logBroadcastMessage(userId, messageHash)
} catch (error) {
  // Don't stop broadcast - message was already sent
  console.error(`Failed to log broadcast for user ${userId}:`, error)
}
```

### 2. Message Send Failures

- Log failed user IDs
- Continue to next user (don't stop entire broadcast)
- Report failed count in summary

### 3. Lock Timeout Protection

```typescript
let broadcastStartTime: number | null = null

// Set timestamp when broadcast starts
broadcastStartTime = Date.now()

// Check for timeout in loop
if (broadcastStartTime && Date.now() - broadcastStartTime > 2 * 60 * 60 * 1000) {
  console.warn('[Broadcast] Timeout reached (2 hours), releasing lock')
  break
}
```

Prevents stuck lock from blocking new broadcasts indefinitely.

### 4. Empty Recipient List

```typescript
if (recipients.length === 0) {
  await sendMessage(user.id, `❌ No users match the specified criteria.`)
  return
}
```

### 5. Telegram API Rate Limit (429 Error)

```typescript
try {
  await sendMessage(userId, message)
} catch (error: any) {
  if (error.response?.statusCode === 429) {
    const retryAfter = error.response.data.retry_after || 30
    console.warn(`[Broadcast] Rate limited, waiting ${retryAfter}s`)
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
    continue // Retry this user
  }
  failedCount++
}
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | Modify | Add `BroadcastLog` model |
| `src/lib/broadcast-config.ts` | Create | Configuration constants |
| `src/lib/broadcast.ts` | Create | Broadcast utility functions |
| `src/app/api/telegram/webhook/route.ts` | Modify | Update `sendBroadcast()` function |
| `src/app/api/admin/broadcast/route.ts` | Modify | Add duplicate checking to API endpoint |

---

## Testing Plan

### Unit Testing
- Test message hash generation consistency
- Test duplicate detection logic
- Test configuration values
- Test log cleanup function

### Integration Testing
- Test broadcast to small group (10-20 users)
- Verify duplicates are prevented within timeframe
- Verify messages delivered after timeframe expires
- Test error scenarios (network failures, database errors)
- Test lock timeout mechanism

### Manual Testing Checklist
- [ ] Send broadcast to yourself twice quickly
- [ ] Verify second send is skipped (deduplication)
- [ ] Wait 24+ hours
- [ ] Send broadcast again
- [ ] Verify message is delivered (deduplication expired)
- [ ] Test with 100+ users to verify performance
- [ ] Test all broadcast commands (`/broadcast`, `/broadcast_active`, `/broadcast_premium`)
- [ ] Test API endpoint with curl script
- [ ] Test `/stop_broadcast` command
- [ ] Verify database logs are created correctly
- [ ] Verify old logs are cleaned up after retention period

---

## Performance Considerations

- **Database queries**: 1 query per recipient (acceptable for 1000+ users)
- **Memory usage**: Minimal - no in-memory storage of sent messages
- **Network**: 100ms delay between messages = ~10 messages/second (well under Telegram's 30 msg/sec limit)
- **Database size**: With 1000 users and 1 broadcast/day, ~30,000 logs/month = negligible

---

## Future Enhancements (Out of Scope)

- Web dashboard for broadcast management
- Scheduled broadcasts
- Broadcast templates
- Detailed delivery analytics
- User opt-out mechanism
- Multiple server instance support (requires Redis)
