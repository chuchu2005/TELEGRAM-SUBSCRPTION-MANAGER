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

### Changes Required

#### 1. Database Entry
Add new document to `PromoCode` collection in MongoDB:

```javascript
{
  code: "basic1",
  name: "Basic 1 Week Free",
  planType: "basic",
  durationDays: 7,
  hasCopierAccess: false,
  isFree: true,
  expiresAt: new Date("2099-12-31T23:59:59Z"), // Far future
  usageLimit: null,
  perUserLimit: 1,
  usageCount: 0,
  createdAt: new Date(),
  updatedAt: new Date()
}
```

#### 2. Update Admin View
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
