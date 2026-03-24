# Design: Admin Promo Code Creation with Inline Keyboards

## Overview
Redesign the `/create_promo` command to use inline keyboard buttons for fast, intuitive promo code creation. Fix critical bug where promo codes stored as uppercase couldn't be redeemed with lowercase input.

## Problem Statement
**Current Issues:**
1. **Critical Bug:** Promo codes created as UPPERCASE, but redemption searches as lowercase → "Invalid promo code" error
2. **Poor UX:** 7-step conversation flow is slow and tedious
3. **Text-Based:** Requires typing back-and-forth for each field

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
5. **Database:** MongoDB with Prisma ORM (`prisma.promoCode` operations)

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

### TypeScript Interface
```typescript
interface PromoCreationState {
  step: 'promo_selections' | 'promo_custom_duration' | 'promo_custom_usage' | 'promo_display_name'
  planType?: 'basic' | 'biweekly' | 'monthly'
  durationDays?: number
  isFree?: boolean
  hasCopierAccess?: boolean
  displayName?: string | null
  expiresAt?: Date
  usageLimit?: number | null
  awaitingCustomInput?: boolean
  customInputType?: 'duration' | 'usage' | null  // Tracks which custom value is being collected
}
```

### Callback Data Structure

All callback data follows the pattern: `promo_<category>_<value>`

**Complete list:**
- `promo_plan_basic`, `promo_plan_biweekly`, `promo_plan_monthly`
- `promo_duration_7`, `promo_duration_14`, `promo_duration_30`, `promo_duration_custom`
- `promo_price_free`, `promo_price_paid`
- `promo_copier_no`, `promo_copier_yes`
- `promo_name_yes`, `promo_name_skip`
- `promo_expiry_90`, `promo_expiry_180`, `promo_expiry_365`, `promo_expiry_never`
- `promo_limit_unlimited`, `promo_limit_50`, `promo_limit_100`, `promo_limit_custom`

**Callback Handler Mapping:**
The `handlePromoButtonCallback()` function parses callback_data and updates conversation state:
- Extract category and value from callback_data (e.g., `promo_plan_basic` → category: `plan`, value: `basic`)
- Update corresponding state field (e.g., `state.planType = 'basic'`)
- Check if all required fields are set after each update
- If all required fields set, delete keyboard and prompt for code name
- If custom value selected, set `awaitingCustomInput: true` and prompt for input

### Custom Value Flow

When admin clicks a "✏️ Custom" button:

1. **Immediate Prompt:** Bot sends a text message immediately asking for the custom value
2. **State Update:** Set `awaitingCustomInput: true` and `customInputType` in conversation state
3. **Store Context:** Track which field is being customized (duration vs usage limit)
4. **Validation:**
   - Duration: Must be number between 1-365
   - Usage Limit: Must be number between 1-1000
5. **Error Handling:**
   - Invalid input (non-number): "Please enter a valid number"
   - Out of range: Show valid range and ask again
6. **Cancel Handling:**
   - Admin sends /cancel → Clear state, send "Promo code creation cancelled"
   - Return to normal conversation state
   - Keyboard message is deleted when /cancel is sent
7. **Re-selection:** Admin can click a different preset button to override custom value (this clears `customInputType`)
8. **Final Confirmation:** Show selected custom value before asking for code name

**Example interaction:**
```
Admin: [Clicks ✏️ Custom on Duration row]
Bot: "Enter custom duration (1-365 days):"
Admin: "15"
Bot: "✅ Duration set to 15 days" [Keyboard remains visible]
```

### Button State Management

**Strategy:** Use internal state tracking without editing keyboard buttons

1. **Track Selections:** Store all selections in conversation state
2. **No Visual Feedback:** Buttons do NOT change appearance (no ✅ indicators)
3. **Final Summary:** When all required fields selected, show summary before asking for code name
4. **Deselection:** Clicking same button twice has no effect (idempotent)
5. **Change Selection:** Clicking different option in same category replaces previous selection

**Rationale:** Editing inline keyboard messages requires complex message updates and can be buggy. Simple state tracking is more reliable.

### Completion Trigger Logic

**When does bot ask for code name?**

1. **Check After Every Button Click:** After each callback, validate state
2. **Required Fields Must Be Set:**
   - `planType` is defined
   - `durationDays` is defined
   - `isFree` is defined
   - `hasCopierAccess` is defined
   - `expiresAt` is defined
   - `usageLimit` is defined
3. **Optional Fields:**
   - `displayName` can be null (if "Skip Name" clicked)
4. **Action:** When all required fields present, delete keyboard message and prompt for code name

**Example:**
```typescript
function areAllRequiredFieldsSet(state: PromoCreationState): boolean {
  // Must not be waiting for custom input
  if (state.awaitingCustomInput) {
    return false
  }

  // All required fields must be set
  return !!(
    state.planType &&
    state.durationDays &&
    state.isFree !== undefined &&
    state.hasCopierAccess !== undefined &&
    state.expiresAt &&
    state.usageLimit !== undefined
  )
}
```

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
  { text: '✅ With Copier', callback_data: 'promo_copier_yes' }
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
2. **Bot:** Validates admin, shows keyboard with 7 rows
3. **Admin:** Clicks [💎 Basic]
4. **Bot:** Updates state (no visible change to buttons)
5. **Admin:** Clicks [7 days]
6. **Bot:** Updates state
7. **Admin:** Clicks [🎁 FREE]
8. **Bot:** Updates state
9. **Admin:** Clicks [❌ No Copier]
10. **Bot:** Updates state
11. **Admin:** Clicks [⏭️ Skip Name] (optional - could also click [✅ Add Name])
12. **Bot:** Updates state, sets displayName to null
13. **Admin:** Clicks [📅 90 days]
14. **Bot:** Updates state, sets expiresAt to 90 days from now
15. **Admin:** Clicks [♾️ Unlimited]
16. **Bot:** Updates state, sets usageLimit to null
17. **Bot:** Checks state - all required fields present
18. **Bot:** Deletes keyboard message, sends: "✅ All options selected! Please enter your promo code name:"
19. **Admin:** `summer2025`
20. **Bot:** Creates promo code in DB (lowercase: "summer2025"), sends confirmation with details

**Alternative Journey with Custom Duration:**

1. **Admin:** Clicks [✏️ Custom] on Duration row
2. **Bot:** Sends text message: "Enter custom duration (1-365 days):"
3. **Admin:** `15`
4. **Bot:** Validates, stores durationDays: 15, sends: "✅ Duration set to 15 days"
5. **Admin:** Continues with other selections...

**Alternative Journey with Display Name:**

1. **Admin:** Clicks [✅ Add Name] on Display Name row
2. **Bot:** Stores flag that display name will be collected
3. **Admin:** Completes all other selections
4. **Bot:** "✅ All options selected! Please enter your promo code name:"
5. **Admin:** `summer2025`
6. **Bot:** "Great! Now enter a display name for this promo code (1-100 chars):"
7. **Admin:** `Summer Sale 2025`
8. **Bot:** Creates promo code with displayName: "Summer Sale 2025"

## Input Validation

### Code Name
- **Format:** Letters and numbers only, 3-20 chars
- **Validation:** Accepts both uppercase and lowercase input (e.g., "SUMMER2025", "summer2025", "SuMmEr2025")
- **Transform:** Convert to lowercase for storage, remove spaces and special chars
- **Uniqueness:** Check database for duplicates (case-insensitive check)
- **User-facing:** Store as lowercase in database, redemption works with any case

### Custom Values
- **Duration:** 1-365 days (number)
- **Usage Limit:** 1-1000 users (number)
- **Display Name:** 1-100 chars (optional)

### Required Button Selections
These must be selected via inline keyboard buttons:
- Plan type
- Duration
- Price (free/paid)
- Copier access
- Expiry
- Usage limit

### Final Input (Text Message)
- Code name (entered after all button selections complete)

### Optional Fields
- Display name (user-friendly description, collected after code name if "✅ Add Name" clicked)

## Error Handling

### Validation Errors
1. **Invalid code format:** "Code must be 3-20 characters, letters and numbers only. Example: summer2025"
2. **Code exists:** "Code 'summer2025' already exists. Try a different code."
3. **Missing selections:** "Please complete all selections first."

### Database Errors
- Generic error message: "Failed to create promo code. Please try again."
- Log detailed error for debugging
- Clear conversation state on error

### Edge Cases
- **Cancel mid-flow:** Clean up conversation state, allow restart (send /cancel)
- **Custom value no input:** Ask again with example
- **Duplicate code:** Offer to show existing code details
- **Code with spaces:** Auto-strip and convert to lowercase (e.g., "summer 2025" → "summer2025")
- **Unexpected text messages:** While keyboard is displayed, ignore non-cancel text messages with hint: "Please use the buttons above or send /cancel to exit"
- **Admin clicks same button twice:** No effect (idempotent)
- **Admin switches to preset after choosing custom:** Preset value overrides custom value

## Bug Fix: Case-Insensitive Promo Codes

### Location
- **File:** `src/app/api/telegram/webhook/route.ts`
- **Function:** `redeemPromoCode()` (called by `/promo` command handler)
- **Current Bug:** Codes stored as uppercase but searched as lowercase

### Current Bug
```typescript
// Creation stores as UPPERCASE
await prisma.promoCode.create({
  data: {
    code: data.code,  // "BASIC1"
    // ... other fields
  }
})

// Redemption searches as lowercase
const code = promoCodeInput.trim().toLowerCase()  // "basic1"

const promo = await prisma.promoCode.findUnique({
  where: { code: code }  // Looking for "basic1"
})

// Database has "BASIC1", searching for "basic1" → Not found ❌
```

### Fix
```typescript
// Store as LOWERCASE (in creation)
await prisma.promoCode.create({
  data: {
    code: data.code.toLowerCase(),  // "basic1"
    // ... other fields
  }
})

// Redemption searches as lowercase (unchanged)
const code = promoCodeInput.trim().toLowerCase()  // "basic1"

const promo = await prisma.promoCode.findUnique({
  where: { code: code }  // Looking for "basic1"
})

// Database has "basic1", searching for "basic1" → Found ✅
```

### Migration Strategy
- **Existing codes:** No immediate migration needed - they remain uppercase in database
- **Backward compatibility:** Update redemption logic to try lowercase first, then try case-insensitive search:
  ```typescript
  // Try exact match (lowercase) first
  let promo = await prisma.promoCode.findUnique({
    where: { code: code }
  })

  // If not found and code contains uppercase, try case-insensitive
  if (!promo && code !== code.toLowerCase()) {
    promo = await prisma.promoCode.findFirst({
      where: {
        code: {
          equals: code,
          mode: 'insensitive'  // Case-insensitive search
        }
      }
    })
  }
  ```
- **Future:** All new codes stored as lowercase
- **Optional one-time cleanup:** Run migration script to convert existing uppercase codes to lowercase

## Testing

### Manual Testing Checklist

#### Creation Flow
- [ ] Admin sends `/create_promo` → Keyboard appears
- [ ] All 7 rows of buttons visible
- [ ] Click each plan type → State updates
- [ ] Click each duration → State updates
- [ ] Click FREE/PAID → State updates
- [ ] Click copier options → State updates
- [ ] Click skip name/add name → State updates
- [ ] Click expiry options → State updates
- [ ] Click usage limit → State updates
- [ ] Type code name → Creates in database via Prisma
- [ ] Check database → Code stored as lowercase

#### Custom Values
- [ ] Click "✏️ Custom" duration → Bot asks for number
- [ ] Type "5" → Validates, stores, confirms with message
- [ ] Click "✏️ Custom" usage → Bot asks for number
- [ ] Type "25" → Validates, stores, confirms with message
- [ ] Click preset after custom → Preset overrides custom
- [ ] Click "✅ Add Name" → Completes selections, asks for code
- [ ] Type code → Bot then asks for display name
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
- [ ] Cancel mid-creation with /cancel → State cleared
- [ ] Send random text while keyboard visible → Hint message
- [ ] Create code with 0 days → Validation error
- [ ] Create code with 1001 days → Validation error
- [ ] Enter "abc" for custom duration → Validation error

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

**File: `src/app/api/telegram/webhook/route.ts`**

**Unit 1: Command Handler**
- Update `/create_promo` command handler to call `handleCreatePromoV2()`
- Add admin permission check

**Unit 2: Keyboard Renderer**
- Add `showPromoCreationKeyboard()` function
- Returns inline keyboard with 7 rows of buttons
- Each button has callback_data in format `promo_<category>_<value>`

**Unit 3: Callback Handler**
- Add `handlePromoButtonCallback()` function
- Parse callback_data, update conversation state
- Check if all required fields set, trigger code name prompt
- Handle custom value selection by setting `awaitingCustomInput`

**Unit 4: State Manager**
- Add validation logic `areAllRequiredFieldsSet()`
- Handle text input for custom values, code name, display name
- Handle /cancel command to clean up state

**Unit 5: Bug Fix in Redemption Flow**
- Update `redeemPromoCode()` function (called by `/promo` command)
- Add case-insensitive fallback query for existing uppercase codes
- Ensure new codes stored as lowercase

**Database Schema:** No changes needed (PromoCode collection already exists in Prisma schema)

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
