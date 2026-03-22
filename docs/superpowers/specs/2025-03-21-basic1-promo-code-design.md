# Design: Add "basic1" Promo Code

## Overview
Add a new free promo code "basic1" to the Telegram VIP bot that gives users 1 week of Basic VIP plan access when redeemed.

## Requirements

### Functional Requirements
- Create promo code "basic1" in the database
- Code must be redeemable via `/promo basic1` command
- Each Telegram user can only redeem this code once
- Code must not expire (indefinite validity)
- Code must provide 7 days of Basic VIP plan access
- Access must be free (no payment required)
- No auto copier bot access included

### Non-Functional Requirements
- Code must work with existing promo redemption system
- Must appear in admin view when listing promo codes
- Must track usage per user
- Must validate against duplicate redemptions

## Specifications

### Promo Code Configuration
```javascript
{
  code: "basic1",
  name: "Basic 1 Week Free",
  planType: "basic",
  durationDays: 7,
  hasCopierAccess: false,
  isFree: true,
  amountKobo: null,
  expiresAt: null, // Never expires
  usageLimit: null, // Unlimited total uses
  perUserLimit: 1 // Once per user
}
```

### User Experience
1. User sends command: `/promo basic1`
2. Bot validates:
   - Code exists in database
   - Code has not expired
   - User has not already used this code
   - Usage limit not reached (if set)
3. Bot creates subscription:
   - Plan type: basic
   - Duration: 7 days
   - Start date: now
   - End date: now + 7 days
4. Bot sends:
   - Success message
   - VIP channel invite link

### Admin Experience
When admin sends `/promo`, they see:
```
✨ EXTRA - 1 Week Premium + Meta Copier (FREE)
✨ EXTRA2 - 2 Weeks Premium + Meta Copier (FREE)
✨ VIP - 1 Week Basic Only (FREE)
✨ DISCOUNT - 1 Week Basic (₦3,000)
✨ BASIC1 - 1 Week Basic (FREE) [NEW]
```

## Implementation

### Current System Issue
The current `/promo` command is **broken** - it doesn't check the PromoCode database. Instead, it just treats promo codes as payment references and calls `handleVerify()`, which fails because promo codes aren't valid Paystack references.

**We need to fix the promo code redemption logic first.**

### Changes Required

#### 1. Fix Promo Code Redemption Logic
File: `src/app/api/telegram/webhook/route.ts`

Location: `handlePromo()` function, around line 1795-1843

**Current broken code:**
```typescript
} else {
  // Treat the promo code as a reference for 'basic' plan verification
  // This is how the existing logic was structured
  await handleVerify(from, args[0], 'basic')
}
```

**New fixed code:**
```typescript
} else {
  // Properly validate and redeem promo code from database
  await redeemPromoCode(from, args[0])
}
```

**Add new function `redeemPromoCode()`:**
```typescript
async function redeemPromoCode(user: TelegramUser, promoCode: string): Promise<void> {
  const userId = user.id.toString()
  const code = promoCode.trim().toLowerCase()

  // 1. Check if promo code exists in database
  const promo = await prisma.promoCode.findUnique({
    where: { code: code }
  })

  if (!promo) {
    await sendMessage(user.id, `❌ <b>Invalid Promo Code</b>

The promo code "${promoCode}" doesn't exist.

Please check the code and try again, or contact admin.`)
    return
  }

  // 2. Check if promo has expired
  if (promo.expiresAt && promo.expiresAt < new Date()) {
    await sendMessage(user.id, `❌ <b>Promo Code Expired</b>

This promo code has expired.

Please contact admin for a new code.`)
    return
  }

  // 3. Check if usage limit reached
  if (promo.usageLimit && promo.usageCount >= promo.usageLimit) {
    await sendMessage(user.id, `❌ <b>Promo Code Fully Redeemed</b>

This promo code has reached its usage limit.

Please contact admin.`)
    return
  }

  // 4. Check if user already used this code
  const existingUsage = await prisma.subscription.findFirst({
    where: {
      telegramUserId: userId,
      promoCode: code
    }
  })

  if (existingUsage) {
    await sendMessage(user.id, `❌ <b>Already Redeemed</b>

You've already used this promo code!

Each promo code can only be used once.`)
    return
  }

  // 5. Check if user has active subscription
  const activeSub = await prisma.subscription.findFirst({
    where: {
      telegramUserId: userId,
      expiresAt: { gte: new Date() }
    }
  })

  if (activeSub) {
    await sendMessage(user.id, `⚠️ <b>Active Subscription Found</b>

You already have an active subscription!

Please wait for it to expire before using a promo code.`)
    return
  }

  // 6. Create the subscription
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + promo.durationDays)

  await prisma.subscription.create({
    data: {
      telegramUserId: userId,
      telegramUsername: user.username || null,
      telegramName: user.first_name || null,
      planType: promo.planType as PlanType,
      startDate: new Date(),
      expiresAt: expiresAt,
      promoCode: code,
      hasCopierAccess: promo.hasCopierAccess
    }
  })

  // 7. Increment promo usage count
  await prisma.promoCode.update({
    where: { id: promo.id },
    data: { usageCount: { increment: 1 } }
  })

  // 8. Send success message and invite link
  const inviteLink = await generateInviteLink(user.id.toString())

  await sendMessage(user.id, `✅ <b>Promo Code Redeemed Successfully!</b>

━━━━━━━━━━━━━━━━━━━

🎁 <b>${promo.name}</b>

━━━━━━━━━━━━━━━━━━━

<b>✅ You have ${promo.durationDays} days of ${PLANS[promo.planType as PlanType].name}!</b>

━━━━━━━━━━━━━━━━━━━

<b>📋 Invite Link:</b>

${inviteLink}

━━━━━━━━━━━━━━━━━━━

<b>Important:</b>
• This link expires in 24 hours
• Join now to start receiving VIP signals
• Your access expires on ${expiresAt.toLocaleDateString()}

Enjoy! 🎉`)
}
```

#### 2. Database Entry
Add new document to `PromoCode` collection in MongoDB (using MongoDB shell or admin panel):

```javascript
{
  code: "basic1",
  name: "Basic 1 Week Free",
  planType: "basic",
  durationDays: 7,
  hasCopierAccess: false,
  isFree: true,
  amountKobo: null,
  expiresAt: new Date("2099-12-31T23:59:59Z"), // Far future = never expires
  usageLimit: null, // Unlimited total uses
  perUserLimit: 1,
  usageCount: 0,
  createdAt: new Date(),
  updatedAt: new Date()
}
```

#### 3. Update Admin View
File: `src/app/api/telegram/webhook/route.ts`

Location: `handlePromo()` function, around line 1806

Update the admin promo list message to include:
```typescript
✨ <b>BASIC1</b> - 1 Week Basic (FREE)
```

Add it to the usage examples:
```typescript
/basic1
```

## Testing

### Manual Testing Steps
1. Add promo code to database via MongoDB shell or admin panel
2. As admin, send `/promo` and verify BASIC1 appears in list
3. As new user, send `/promo basic1`
4. Verify success message and invite link are sent
5. Check database: subscription created, promo usageCount incremented
6. As same user, send `/promo basic1` again
7. Verify error message ("already used this code")
8. Check VIP channel: user has access
9. After 7 days, verify access expired

### Edge Cases to Test
- User tries to redeem non-existent code
- User tries to redeem expired code (if we add expiry later)
- User tries to redeem same code twice
- Usage limit reached (if we set a limit)
- Code with special characters or spaces
- Case sensitivity (basic1 vs BASIC1)

## Rollout Plan
1. Add promo code to MongoDB database
2. Update webhook route.ts with admin view changes
3. Test manually with test Telegram account
4. Deploy to production
5. Announce to users (if needed)

## Success Criteria
✅ Promo code "basic1" exists in database
✅ Admin view shows BASIC1 in promo list
✅ Users can successfully redeem `/promo basic1`
✅ Redeemed users receive 7-day Basic subscription
✅ Users cannot redeem same code twice
✅ Code never expires
✅ No payment required for redemption
