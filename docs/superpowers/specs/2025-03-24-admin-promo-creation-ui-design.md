# Design: Admin Promo Code Creation with Inline Keyboards

## Overview
Redesign the `/create_promo` command to use inline keyboard buttons for fast, intuitive promo code creation. Fix critical bug where promo codes stored as uppercase couldn't be redeemed with lowercase input.

## Problem Statement
**Current Issues:**
1. **Critical Bug:** Promo codes created as UPPERCASE, but redemption searches as lowercase → "Invalid promo code" error
2. **Poor UX:** 7-step conversation flow is slow and tedious
3. **Text-Based:** Requires typing back-and-forthruh for each field

**User Impact:**
- Admins can create codes but users can't redeem them
- Takes 2-3 minutes to create one promo code
- High friction for admins

## Solution
Replace conversation flow with inline keyboard buttons. All options visible at once, click to select. Store codes as lowercase to fix redemption bug.

## Architecture

### Components
1. **`handleCreatePromoV2()`** - Main handler for new flow
2. **`handlePromoButtonCallback()`** - Processes button clicks
3. **`showPromoCreationKeyboard()`** - Displays inline keyboard
4. **State Management:** Uses existing conversation state system
5. **Database:** MongoDB `PromoCode` collection with lowercase codes

### Data Flow
```
Admin → /create_promo → Bot checks permissions
→ Show inline keyboard (7 rows of buttons)
→ Admin clicks buttons → Update conversation state
→ Bot collects all selections → Ask for code name
→ Admin provides code → Validate → Create in DB (lowercase)
→ Send confirmation + redemption instructions
```

### State Management
- **Step:** `promo_selections`
- **Data stored:**
  - `planType`: 'basic' | 'biweekly' | 'monthly'
  - `durationDays`: number
  - `isFree`: boolean
  - `hasCopierAccess`: boolean
  - `displayName`: string | null
  - `expiresAt`: Date
  - `usageLimit`: number | null
  - `customDuration`: number | null
  - `customUsage`: number | null

## Inline Keyboard Layout

### All Options on One Screen (7 Rows)

**Row 1 - Plan Type:**
```typescript
[
  { text: '💎 Basic', callback_data: 'promo_plan_basic' },
  { text: '📊 Bi-Weekly', callback_data: 'promo_plan_biweekly' },
  { text: '📅 Monthly', callback_data: 'promo_plan_monthly' }
]
```

**Row 2 - Duration:**
```typescript
[
  { text: '7 days', callback_data: 'promo_duration_7' },
  { text: '14 days', callback_data: 'promo_duration_14' },
  { text: '30 days', callback_data: 'promo_duration_30' },
  { text: '✏️ Custom', callback_data: 'promo_duration_custom' }
]
```

**Row 3 - Price:**
```typescript
[
  { text: '🎁 FREE', callback_data: 'promo_price_free' },
  { text: '💵 PAID', callback_data: 'promo_price_paid' }
]
```

**Row 4 - Copier Access:**
```typescript
[
  { text: '❌ No Copier', callback_data: 'promo_copier_no' },
  { text: '✅ With Copier', callback_data: promo_copier_yes' }
]
```

**Row 5 - Display Name:**
```typescript
[
  { text: '✅ Add Name', callback_data: 'promo_name_yes' },
  { text: '⏭️ Skip Name', callback_data: 'promo_name_skip' }
]
```

**Row 6 - Expiry:**
```typescript
[
  { text: '📅 90 days', callback_data: 'promo_expiry_90' },
  { text: '📅 180 days', callback_data: 'promo_expiry_180' },
  { text: '📅 1 year', callback_data: 'promo_expiry_365' },
  { text: '♾️ Never', callback_data: 'promo_expiry_never' }
]
```

**Row 7 - Usage Limit:**
```typescript
[
  { text: '♾️ Unlimited', callback_data: 'promo_limit_unlimited' },
  { text: '👥 50 users', callback_data: 'promo_limit_50' },
  { text: '👥 100 users', callback_data: 'promo_limit_100' },
  { text: '✏️ Custom', callback_data: 'promo_limit_custom' }
]
```

## Interaction Flow

### Complete User Journey

1. **Admin:** `/create_promo`
2. **Bot:** Validates admin, shows keyboard
3. **Admin:** Clicks [💎 Basic]
4. **Bot:** Updates state, shows ✅ on selected button
5. **Admin:** Clicks [7 days]
6. **Bot:** Updates state
7. **Admin:** Clicks [🎁 FREE]
8. **Bot:** Updates state, checks all required fields selected
9. **Bot:** "✅ All options selected! Name your promo code:"
10. **Admin:** `summer2025`
11. **Bot:** Creates promo code in DB (lowercase), sends confirmation

### Button State Management
- Selected buttons show ✅ indicator
- Last selected option in each category is highlighted
- Bot tracks all selections in conversation state

## Input Validation

### Code Name
- **Format:** Letters and numbers only, 3-20 chars
- **Validation:** `/^[A-Z0-9]{3,20}$/`
- **Transform:** Convert to uppercase, remove spaces
- **Uniqueness:** Check database for duplicates

### Custom Values
- **Duration:** 1-365 days (number)
- **Usage Limit:** 1-1000 users (number)
- **Display Name:** 1-100 chars (optional)

### Required Fields
- Plan type
- Duration
- Price (free/paid)
- Copier access
- Expiry
- Usage limit
- Code name

## Error Handling

### Validation Errors
1. **Invalid code format:** "Code must be 3-20 characters, letters and numbers only. Example: SUMMER2025"
2. **Code exists:** "Code 'SUMMER2025' already exists. Try a different code."
3. **Missing selections:** "Please complete all selections first."

### Database Errors
- Generic error message: "Failed to create promo code. Please try again."
- Log detailed error for debugging
- Clear conversation state on error

### Edge Cases
- **Cancel mid-flow:** Clean up conversation state, allow restart
- **Custom value no input:** Ask again with example
- **Duplicate code:** Offer to show existing code details
- **Code with spaces:** Auto-strip and uppercase (e.g., "summer 2025" → "SUMMER2025")

## Bug Fix: Case-Insensitive Promo Codes

### Current Bug
```typescript
// Creation stores as UPPERCASE
code: data.code  // "BASIC1"

// Redemption searches as lowercase
const code = promoCodeInput.trim().toLowerCase()  // "basic1"

// Database has "BASIC1", searching for "basic1" → Not found ❌
```

### Fix
```typescript
// Store as LOWERCASE
code: data.code.toLowerCase()  // "basic1"

// Redemption searches as lowercase
const code = promoCodeInput.trim().toLowerCase()  // "basic1"

// Database has "basic1", searching for "basic1" → Found ✅
```

### Impact
- Users can type `/promo basic1`, `/promo BASIC1`, `/promo BaSiC1` - all work
- Codes stored consistently as lowercase
- No more case-sensitivity issues

## Testing

### Manual Testing Checklist

#### Creation Flow
- [ ] Admin sends `/create_promo` → Keyboard appears
- [ ] All 7 rows of buttons visible
- [ ] Click each plan type → State updates
- [ ] Click each duration → State updates
- [ ] Click FREE/PAID → State updates
- [ ] Click copier options → State updates
- [ ] Click name skip/name add → State updates
- [ ] Click expiry options → State updates
- [ ] Click usage limit → State updates
- [ ] Type code name → Creates in database
- [ ] Check MongoDB → Code stored as lowercase

#### Custom Values
- [ ] Click "✏️ Custom" duration → Ask for number
- [ ] Type "5" → Validates and stores
- [ ] Click "✏️ Custom" usage → Ask for number
- [ ] Type "25" → Validates and stores
- [ ] Click "✅ Add Name" → Ask for name
- [ ] Type "Summer Sale" → Stores display name

#### Redemption Flow
- [ ] Create code "test123"
- [ ] User types `/promo test123` → Works ✅
- [ ] User types `/promo TEST123` → Works ✅
- [ ] User types `/promo TeSt123` → Works ✅
- [ ] Check subscription created in database

#### Error Cases
- [ ] Try to create duplicate code → Error message
- [ ] Try invalid code format → Error message
- [ ] Cancel mid-creation → State cleared
- [ ] Create code with 0 days → Validation error
- [ ] Create code with 1001 days → Validation error

### Success Criteria
✅ Promo codes stored as lowercase in database
✅ Case-insensitive redemption works
✅ Admin can create code in under 30 seconds
✅ All button combinations work correctly
✅ Custom values validate properly
✅ Error messages are clear and helpful
✅ State cleanup on cancel/error
✅ Confirmation shows all promo details

## Implementation Notes

### Files to Modify
1. **src/app/api/telegram/webhook/route.ts**
   - Add `handleCreatePromoV2()` function
   - Add `handlePromoButtonCallback()` function
   - Add `showPromoCreationKeyboard()` function
   - Update command handler to use new function

2. **Database Schema:** No changes needed (PromoCode collection already exists)

### Backward Compatibility
- Old `/create_promo` (conversation flow) can be removed
- New command uses same `/create_promo` command name
- Existing promo codes in database (uppercase) still work with case-insensitive search

### Migration Considerations
- Old uppercase codes: Continue working (search will be case-insensitive)
- New codes: Stored as lowercase
- No database migration needed

## Rollout Plan
1. Implement new functions
2. Test locally with admin account
3. Create test promo codes
4. Verify redemption works
5. Deploy to production
6. Monitor for issues
7. Remove old `/create_promo` function if stable
