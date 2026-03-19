# Design: Users Joined Today in BotStats Command

**Date:** 2026-03-19
**Status:** Approved

## Overview

Add a new section to the `/botstats` admin command that displays users who joined the bot today (since midnight), including a count and the first 10 usernames.

## Context

The `/botstats` command currently displays comprehensive statistics including total users, subscribers, referrals, and financials. The admin wants visibility into daily user acquisition by seeing who joined each day.

## Requirements

1. **Time Range**: Today (since midnight, server timezone)
2. **Location**: Within the "Users" section of the stats message
3. **Content**: Show count of users and first 10 usernames
4. **Limit**: If more than 10 users joined, show "and X more"
5. **Fallback**: Use telegramUserId if name/username unavailable

## Data Query

Query the `User` table:
```typescript
const today = new Date()
today.setHours(0, 0, 0, 0) // Start of today

const joinedTodayUsers = await prisma.user.findMany({
  where: {
    createdAt: { gte: today }
  },
  orderBy: { createdAt: 'desc' },
  take: 10,
  select: {
    telegramName: true,
    telegramUsername: true,
    telegramUserId: true
  }
})

const joinedTodayCount = await prisma.user.count({
  where: {
    createdAt: { gte: today }
  }
})
```

## Display Format

The section will be inserted after "Non-paying Users" line:

```
👥 <b>Users:</b>
• Total Bot Users: <b>X</b>
• Unique Subscribers: <b>Y</b>
• Non-paying Users: <b>Z</b>
• Joined Today: <b>N</b> (User1, @user2, User3... and X more)
```

**Example outputs:**

**0 users:**
```
• Joined Today: <b>0</b>
```

**1-10 users (show all):**
```
• Joined Today: <b>3</b> (John, @user2, Jane)
```

**More than 10 users:**
```
• Joined Today: <b>15</b> (User1, @user2, User3... and 5 more)
```

## Implementation Details

1. Set today's start time by zeroing hours/minutes/seconds/milliseconds
2. Query users who joined today with limit of 10
3. Format usernames:
   - If `telegramUsername` exists: `@username`
   - If only `telegramName` exists: `Name`
   - If neither exists: `<userId>`
4. Concatenate names with commas, limit to 10
5. Add "and X more" if count > 10
6. Insert formatted string into Users section of message

## Edge Cases

| Case | Handling |
|------|----------|
| No users today | Show "Joined Today: 0" |
| User has no name/username | Use telegramUserId |
| Only 1 user today | Show single name without trailing comma |
| Exactly 10 users | Show all names, no "and more" suffix |

## Files Modified

- `src/app/api/telegram/webhook/route.ts` - Update `handleBotStats` function
