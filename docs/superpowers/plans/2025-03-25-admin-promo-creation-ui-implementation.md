# Admin Promo Code Creation UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/create_promo` command to use inline keyboard buttons for fast, intuitive promo code creation and fix critical case-sensitivity bug in promo code redemption.

**Architecture:** Replace 7-step conversation flow with single-screen inline keyboard (7 rows of buttons). Track selections in MongoDB conversation state. When all required fields selected, prompt for code name and create promo code in database as lowercase. Update redemption logic to support case-insensitive search for backward compatibility.

**Tech Stack:** Next.js 14, TypeScript, MongoDB with Prisma ORM, Telegram Bot API

---

## Chunk 1: Update Conversation State System

### Task 1: Extend Conversation State Types

**Files:**
- Modify: `src/lib/conversation-state.ts`

- [ ] **Step 1: Add new promo creation state types**

Add to type definitions at top of file:

```typescript
export type PromoCreationStep = 'promo_selections' | 'promo_custom_duration' | 'promo_custom_usage' | 'promo_display_name'

export interface PromoCreationState {
  step: PromoCreationStep
  planType?: 'basic' | 'biweekly' | 'monthly'
  durationDays?: number
  isFree?: boolean
  hasCopierAccess?: boolean
  displayName?: string | null
  expiresAt?: Date
  usageLimit?: number | null
  awaitingCustomInput?: boolean
  customInputType?: 'duration' | 'usage' | null
  code?: string  // Temporarily stores the code name during display name collection
}

// Extend ConversationStateData to include promo creation state
export interface ConversationStateData {
  step: ConversationStep | PromoCreationStep
  data: {
    // MT5 Setup Data
    accountNumber?: string
    password?: string
    server?: string
    // Old Promo Creation Data (deprecated)
    code?: string
    name?: string | null
    planType?: string
    durationDays?: number
    isFree?: boolean
    amountKobo?: number
    hasCopierAccess?: boolean
    // New Promo Creation Data
    promoPlanType?: 'basic' | 'biweekly' | 'monthly'
    promoDurationDays?: number
    promoIsFree?: boolean
    promoHasCopierAccess?: boolean
    promoDisplayName?: string | null
    promoExpiresAt?: Date
    promoUsageLimit?: number | null
    promoAwaitingCustomInput?: boolean
    promoCustomInputType?: 'duration' | 'usage' | null
    promoCode?: string  // Temporarily stores code name during display name collection
  }
}
```

- [ ] **Step 2: Update setConversationState to handle promo creation data**

Update the function to include new fields:

```typescript
export async function setConversationState(userId: string, state: ConversationStateData): Promise<void> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000)

  const encryptedPassword = state.data.password ? encryptPassword(state.data.password) : null

  await prisma.conversationState.upsert({
    where: { telegramUserId: userId },
    update: {
      step: state.step,
      accountNumber: state.data.accountNumber || null,
      password: encryptedPassword,
      server: state.data.server || null,
      // Old promo fields
      promoCode: state.data.code || null,
      promoName: state.data.name || null,
      promoPlanType: state.data.planType || null,
      promoDurationDays: state.data.durationDays || null,
      promoIsFree: state.data.isFree ?? null,
      promoAmountKobo: state.data.amountKobo || null,
      promoHasCopier: state.data.hasCopierAccess || null,
      // New promo creation fields
      newPromoPlanType: state.data.promoPlanType || null,
      newPromoDurationDays: state.data.promoDurationDays || null,
      newPromoIsFree: state.data.promoIsFree ?? null,
      newPromoHasCopier: state.data.promoHasCopierAccess || null,
      newPromoDisplayName: state.data.promoDisplayName || null,
      newPromoExpiresAt: state.data.promoExpiresAt || null,
      newPromoUsageLimit: state.data.promoUsageLimit ?? null,
      newPromoAwaitingCustomInput: state.data.promoAwaitingCustomInput ?? null,
      newPromoCustomInputType: state.data.promoCustomInputType || null,
      newPromoCode: state.data.promoCode || null,
      updatedAt: now,
      expiresAt
    },
    create: {
      telegramUserId: userId,
      step: state.step,
      accountNumber: state.data.accountNumber || null,
      password: encryptedPassword,
      server: state.data.server || null,
      // Old promo fields
      promoCode: state.data.code || null,
      promoName: state.data.name || null,
      promoPlanType: state.data.planType || null,
      promoDurationDays: state.data.durationDays || null,
      promoIsFree: state.data.isFree ?? null,
      promoAmountKobo: state.data.amountKobo || null,
      promoHasCopier: state.data.hasCopierAccess || null,
      // New promo creation fields
      newPromoPlanType: state.data.promoPlanType || null,
      newPromoDurationDays: state.data.promoDurationDays || null,
      newPromoIsFree: state.data.promoIsFree ?? null,
      newPromoHasCopier: state.data.promoHasCopierAccess || null,
      newPromoDisplayName: state.data.promoDisplayName || null,
      newPromoExpiresAt: state.data.promoExpiresAt || null,
      newPromoUsageLimit: state.data.promoUsageLimit ?? null,
      newPromoAwaitingCustomInput: state.data.promoAwaitingCustomInput ?? null,
      newPromoCustomInputType: state.data.promoCustomInputType || null,
      newPromoCode: state.data.promoCode || null,
      createdAt: now,
      updatedAt: now,
      expiresAt
    }
  })

  console.log(`[Conversation State] Saved state for user ${userId}:`, { step: state.step })
}
```

- [ ] **Step 3: Update getConversationState to return new promo creation data**

Update the return statement:

```typescript
return {
  step: state.step as ConversationStep | PromoCreationStep,
  data: {
    // MT5 Setup Data
    accountNumber: state.accountNumber || undefined,
    password: decryptedPassword,
    server: state.server || undefined,
    // Old Promo Creation Data
    code: state.promoCode || undefined,
    name: state.promoName || undefined,
    planType: state.promoPlanType || undefined,
    durationDays: state.promoDurationDays || undefined,
    isFree: state.promoIsFree ?? undefined,
    amountKobo: state.promoAmountKobo ?? undefined,
    hasCopierAccess: state.promoHasCopier ?? undefined,
    // New Promo Creation Data
    promoPlanType: (state as any).newPromoPlanType || undefined,
    promoDurationDays: (state as any).newPromoDurationDays || undefined,
    promoIsFree: (state as any).newPromoIsFree ?? undefined,
    promoHasCopierAccess: (state as any).newPromoHasCopier ?? undefined,
    promoDisplayName: (state as any).newPromoDisplayName || undefined,
    promoExpiresAt: (state as any).newPromoExpiresAt || undefined,
    promoUsageLimit: (state as any).newPromoUsageLimit ?? undefined,
    promoAwaitingCustomInput: (state as any).newPromoAwaitingCustomInput ?? undefined,
    promoCustomInputType: (state as any).newPromoCustomInputType || undefined,
    promoCode: (state as any).newPromoCode || undefined
  }
}
```

- [ ] **Step 4: Update updateConversationData to handle new promo fields**

Add to the updateData object construction:

```typescript
// New Promo Creation Data
if (data.promoPlanType !== undefined) updateData.newPromoPlanType = data.promoPlanType
if (data.promoDurationDays !== undefined) updateData.newPromoDurationDays = data.promoDurationDays
if (data.promoIsFree !== undefined) updateData.newPromoIsFree = data.promoIsFree
if (data.promoHasCopierAccess !== undefined) updateData.newPromoHasCopier = data.promoHasCopierAccess
if (data.promoDisplayName !== undefined) updateData.newPromoDisplayName = data.promoDisplayName
if (data.promoExpiresAt !== undefined) updateData.newPromoExpiresAt = data.promoExpiresAt
if (data.promoUsageLimit !== undefined) updateData.newPromoUsageLimit = data.promoUsageLimit
if (data.promoAwaitingCustomInput !== undefined) updateData.newPromoAwaitingCustomInput = data.promoAwaitingCustomInput
if (data.promoCustomInputType !== undefined) updateData.newPromoCustomInputType = data.promoCustomInputType
if (data.promoCode !== undefined) updateData.newPromoCode = data.promoCode
```

- [ ] **Step 5: Update Prisma schema**

Add new fields to `ConversationState` model in `prisma/schema.prisma`:

```prisma
model ConversationState {
  id              String   @id @default(cuid())
  telegramUserId  String   @unique
  step            String
  accountNumber   String?
  password        String?
  server          String?

  // Old promo fields (deprecated)
  promoCode        String?
  promoName        String?
  promoPlanType    String?
  promoDurationDays Int?
  promoIsFree      Boolean?
  promoAmountKobo  Int?
  promoHasCopier   Boolean?

  // New promo creation fields
  newPromoPlanType         String?
  newPromoDurationDays     Int?
  newPromoIsFree           Boolean?
  newPromoHasCopier        Boolean?
  newPromoDisplayName      String?
  newPromoExpiresAt        DateTime?
  newPromoUsageLimit       Int?
  newPromoAwaitingCustomInput Boolean?
  newPromoCustomInputType  String?
  newPromoCode             String?  // Temporarily stores code name during display name collection

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  expiresAt      DateTime

  @@index([expiresAt])
}
```

- [ ] **Step 6: Run Prisma migration**

```bash
npx prisma migrate dev --name add_promo_creation_fields
```

- [ ] **Step 6b: Verify migration**

Check that new fields exist in database:

```bash
npx prisma studio
```

In Prisma Studio, check the `ConversationState` table for new fields:
- newPromoPlanType
- newPromoDurationDays
- newPromoIsFree
- newPromoHasCopier
- newPromoDisplayName
- newPromoExpiresAt
- newPromoUsageLimit
- newPromoAwaitingCustomInput
- newPromoCustomInputType
- newPromoCode

Expected: All new fields visible in the table

- [ ] **Step 7: Commit changes**

```bash
git add src/lib/conversation-state.ts prisma/schema.prisma
git commit -m "feat: extend conversation state for new promo creation flow

- Add PromoCreationStep type for new flow
- Add PromoCreationState interface with all selection fields
- Support custom duration and usage limit input
- Add awaitingCustomInput flag for validation
- Extend ConversationState with new promo fields
- Update Prisma schema with new fields

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: Create Keyboard Renderer

### Task 2: Implement Inline Keyboard Builder

**Files:**
- Create: `src/lib/promo-keyboards.ts`

- [ ] **Step 1: Create keyboard builder file**

Create new file with:

```typescript
/**
 * Promo Code Creation Inline Keyboards
 * Builds interactive button menus for admin promo code creation
 */

export interface InlineKeyboardButton {
  text: string
  callback_data: string
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][]
}

/**
 * Returns the complete promo creation keyboard with all 7 rows
 */
export function promoCreationKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      // Row 1: Plan Type
      [
        { text: '💎 Basic', callback_data: 'promo_plan_basic' },
        { text: '📊 Bi-Weekly', callback_data: 'promo_plan_biweekly' },
        { text: '📅 Monthly', callback_data: 'promo_plan_monthly' }
      ],
      // Row 2: Duration
      [
        { text: '7 days', callback_data: 'promo_duration_7' },
        { text: '14 days', callback_data: 'promo_duration_14' },
        { text: '30 days', callback_data: 'promo_duration_30' },
        { text: '✏️ Custom', callback_data: 'promo_duration_custom' }
      ],
      // Row 3: Price
      [
        { text: '🎁 FREE', callback_data: 'promo_price_free' },
        { text: '💵 PAID', callback_data: 'promo_price_paid' }
      ],
      // Row 4: Copier Access
      [
        { text: '❌ No Copier', callback_data: 'promo_copier_no' },
        { text: '✅ With Copier', callback_data: 'promo_copier_yes' }
      ],
      // Row 5: Display Name
      [
        { text: '✅ Add Name', callback_data: 'promo_name_yes' },
        { text: '⏭️ Skip Name', callback_data: 'promo_name_skip' }
      ],
      // Row 6: Expiry
      [
        { text: '📅 90 days', callback_data: 'promo_expiry_90' },
        { text: '📅 180 days', callback_data: 'promo_expiry_180' },
        { text: '📅 1 year', callback_data: 'promo_expiry_365' },
        { text: '♾️ Never', callback_data: 'promo_expiry_never' }
      ],
      // Row 7: Usage Limit
      [
        { text: '♾️ Unlimited', callback_data: 'promo_limit_unlimited' },
        { text: '👥 50 users', callback_data: 'promo_limit_50' },
        { text: '👥 100 users', callback_data: 'promo_limit_100' },
        { text: '✏️ Custom', callback_data: 'promo_limit_custom' }
      ]
    ]
  }
}
```

- [ ] **Step 2: Verify file compiles**

```bash
npx tsc --noEmit
```

Expected: No TypeScript errors

- [ ] **Step 3: Commit keyboard builder**

```bash
git add src/lib/promo-keyboards.ts
git commit -m "feat: add promo creation keyboard builder

- Create promoCreationKeyboard() with 7 rows of buttons
- All callback data follows promo_<category>_<value> pattern
- Export InlineKeyboardButton and InlineKeyboardMarkup types
- Support custom values for duration and usage limit

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: Implement Main Handler and Button Callback Processor

### Task 3: Create New Promo Creation Handler

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Import keyboard builder**

Add to imports at top of file:

```typescript
import { promoCreationKeyboard } from '@/lib/promo-keyboards'
```

- [ ] **Step 2: Add validation helper function**

Add after existing helper functions:

```typescript
/**
 * Check if all required promo creation fields are set
 */
function areAllRequiredFieldsSet(state: any): boolean {
  // Must not be waiting for custom input
  if (state.promoAwaitingCustomInput) {
    return false
  }

  // All required fields must be set
  return !!(
    state.promoPlanType &&
    state.promoDurationDays &&
    state.promoIsFree !== undefined &&
    state.promoHasCopierAccess !== undefined &&
    state.promoExpiresAt &&
    state.promoUsageLimit !== undefined
  )
}
```

- [ ] **Step 3: Create new promo creation handler**

Add after old `handleCreatePromo` function:

```typescript
/**
 * Handle /create_promo command - NEW VERSION with inline keyboards
 * Admin creates custom promo codes using interactive buttons
 */
async function handleCreatePromoV2(user: TelegramUser): Promise<void> {
  const userId = user.id.toString()

  // Check if admin
  if (user.id !== ADMIN_ID) {
    await sendMessage(user.id, '❌ Only the admin can use this command.')
    return
  }

  // Initialize conversation state for new promo creation flow
  await setConversationState(userId, {
    step: 'promo_selections',
    data: {
      promoPlanType: undefined,
      promoDurationDays: undefined,
      promoIsFree: undefined,
      promoHasCopierAccess: undefined,
      promoDisplayName: null,
      promoExpiresAt: undefined,
      promoUsageLimit: undefined,
      promoAwaitingCustomInput: false,
      promoCustomInputType: null,
      promoCode: undefined
    }
  })

  // Send welcome message with inline keyboard
  const message = `🎁 <b>Create Promo Code</b>

━━━━━━━━━━━━━━━━━━━

<b>Configure your promo code using the buttons below:</b>

Select all options and I'll ask for the code name when complete.

━━━━━━━━━━━━━━━━━━━

<i>💡 Tip: Click the buttons to make selections</i>`

  await sendMessageWithKeyboard(user.id, message, promoCreationKeyboard())
}
```

- [ ] **Step 4: Create callback handler**

Add after `handleCreatePromoV2`:

```typescript
/**
 * Handle promo creation button callbacks
 * Updates conversation state and checks for completion
 */
async function handlePromoButtonCallback(
  user: TelegramUser,
  callbackQueryId: string,
  callbackData: string,
  messageId: number
): Promise<void> {
  const userId = user.id.toString()

  // Acknowledge the button click
  await answerCallbackQuery(callbackQueryId)

  // Get current state
  const state = await getConversationState(userId)
  if (!state || state.step !== 'promo_selections') {
    await sendMessage(user.id, '❌ Invalid state. Please start over with /create_promo')
    return
  }

  // Parse callback data
  const parts = callbackData.split('_')
  if (parts[0] !== 'promo' || parts.length < 3) {
    console.error('[Promo Creation] Invalid callback data:', callbackData)
    return
  }

  const category = parts[1] // plan, duration, price, copier, name, expiry, limit
  const value = parts[2]    // basic, biweekly, monthly, 7, 14, etc.

  console.log(`[Promo Creation] User ${userId} selected: ${category} = ${value}`)

  // Update state based on category
  switch (category) {
    case 'plan':
      await updateConversationData(userId, {
        promoPlanType: value as 'basic' | 'biweekly' | 'monthly'
      })
      break

    case 'duration':
      if (value === 'custom') {
        await updateConversationData(userId, {
          promoAwaitingCustomInput: true,
          promoCustomInputType: 'duration'
        })
        await sendMessage(user.id, `✏️ <b>Custom Duration</b>

━━━━━━━━━━━━━━━━━━━

Enter custom duration (1-365 days):

<i>Example: 15</i>

━━━━━━━━━━━━━━━━━━━

Send /cancel to exit`)
      } else {
        await updateConversationData(userId, {
          promoDurationDays: parseInt(value)
        })
      }
      break

    case 'price':
      await updateConversationData(userId, {
        promoIsFree: value === 'free'
      })
      break

    case 'copier':
      await updateConversationData(userId, {
        promoHasCopierAccess: value === 'yes'
      })
      break

    case 'name':
      await updateConversationData(userId, {
        promoDisplayName: value === 'yes' ? '' : null // Empty string means "will collect later"
      })
      break

    case 'expiry':
      const now = new Date()
      let expiresAt: Date

      switch (value) {
        case '90':
          expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
          break
        case '180':
          expiresAt = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000)
          break
        case '365':
          expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
          break
        case 'never':
          expiresAt = new Date('2099-12-31T23:59:59Z')
          break
        default:
          return
      }

      await updateConversationData(userId, { promoExpiresAt: expiresAt })
      break

    case 'limit':
      if (value === 'custom') {
        await updateConversationData(userId, {
          promoAwaitingCustomInput: true,
          promoCustomInputType: 'usage'
        })
        await sendMessage(user.id, `✏️ <b>Custom Usage Limit</b>

━━━━━━━━━━━━━━━━━━━

Enter custom usage limit (1-1000 users):

<i>Example: 25</i>

━━━━━━━━━━━━━━━━━━━

Send /cancel to exit`)
      } else {
        await updateConversationData(userId, {
          promoUsageLimit: value === 'unlimited' ? null : parseInt(value)
        })
      }
      break

    default:
      console.error('[Promo Creation] Unknown category:', category)
      return
  }

  // Check if all required fields are set
  const updatedState = await getConversationState(userId)
  if (updatedState && areAllRequiredFieldsSet(updatedState.data)) {
    // Delete the keyboard message
    try {
      await deleteMessage(user.id, messageId)
    } catch (error) {
      console.error('[Promo Creation] Failed to delete keyboard message:', error)
    }

    // Prompt for code name
    await sendMessage(user.id, `✅ <b>All options selected!</b>

━━━━━━━━━━━━━━━━━━━

Please enter your promo code name:

<i>3-20 characters, letters and numbers only</i>
<i>Example: summer2025</i>

━━━━━━━━━━━━━━━━━━━

Send /cancel to exit`)
  }
}
```

- [ ] **Step 5: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 6: Commit new handlers**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "feat: add new promo creation handler and callback processor

- Add handleCreatePromoV2() with inline keyboard
- Add handlePromoButtonCallback() for button processing
- Add areAllRequiredFieldsSet() validation helper
- Support all 7 button categories
- Handle custom value prompts for duration and usage limit
- Delete keyboard and prompt for code name when complete

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 4: Handle Text Input and Code Creation

### Task 4: Implement Text Input Handler

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Create promo creation text handler**

Add after `handlePromoButtonCallback`:

```typescript
/**
 * Handle text input during promo creation flow
 * Processes custom values, code name, and display name
 */
async function handlePromoCreationTextInput(user: TelegramUser, text: string): Promise<void> {
  const userId = user.id.toString()
  const trimmedText = text.trim()

  // Get current state
  const state = await getConversationState(userId)
  if (!state) {
    return // Not in promo creation flow
  }

  const data = state.data

  // Handle custom input (duration or usage limit)
  if (data.promoAwaitingCustomInput) {
    const inputType = data.promoCustomInputType
    const value = parseInt(trimmedText)

    if (isNaN(value)) {
      await sendMessage(user.id, `❌ <b>Invalid Input</b>

━━━━━━━━━━━━━━━━━━━

Please enter a valid number.

━━━━━━━━━━━━━━━━━━━`)
      return
    }

    if (inputType === 'duration') {
      if (value < 1 || value > 365) {
        await sendMessage(user.id, `❌ <b>Invalid Duration</b>

━━━━━━━━━━━━━━━━━━━

Duration must be between 1 and 365 days.

━━━━━━━━━━━━━━━━━━━`)
        return
      }

      await updateConversationData(userId, {
        promoDurationDays: value,
        promoAwaitingCustomInput: false,
        promoCustomInputType: null
      })

      await sendMessage(user.id, `✅ <b>Duration set to ${value} days</b>

━━━━━━━━━━━━━━━━━━━

Continue selecting options or wait for code name prompt.`)
    } else if (inputType === 'usage') {
      if (value < 1 || value > 1000) {
        await sendMessage(user.id, `❌ <b>Invalid Usage Limit</b>

━━━━━━━━━━━━━━━━━━━

Usage limit must be between 1 and 1000 users.

━━━━━━━━━━━━━━━━━━━`)
        return
      }

      await updateConversationData(userId, {
        promoUsageLimit: value,
        promoAwaitingCustomInput: false,
        promoCustomInputType: null
      })

      await sendMessage(user.id, `✅ <b>Usage limit set to ${value} users</b>

━━━━━━━━━━━━━━━━━━━

Continue selecting options or wait for code name prompt.`)
    }

    return
  }

  // Handle code name input
  if (state.step === 'promo_selections' && areAllRequiredFieldsSet(data)) {
    // Validate code format
    const codeValidation = /^[a-z0-9]{3,20}$/i
    if (!codeValidation.test(trimmedText)) {
      await sendMessage(user.id, `❌ <b>Invalid Code Format</b>

━━━━━━━━━━━━━━━━━━━

Code must be 3-20 characters, letters and numbers only.

Example: summer2025

━━━━━━━━━━━━━━━━━━━

Please try again or send /cancel to exit.`)
      return
    }

    // Convert to lowercase
    const code = trimmedText.toLowerCase()

    // Check if code already exists
    const existing = await prisma.promoCode.findUnique({
      where: { code: code }
    })

    if (existing) {
      await sendMessage(user.id, `❌ <b>Code Already Exists</b>

━━━━━━━━━━━━━━━━━━━

The code "${code}" already exists!

Please try a different code or send /cancel to exit.`)
      return
    }

    // Check if display name is needed
    // Note: data.promoDisplayName === '' means "will collect display name later"
    //       data.promoDisplayName === null means "skip display name"
    if (data.promoDisplayName === '') {
      // Prompt for display name
      await updateConversationData(userId, { promoCode: code })
      await setConversationState(userId, {
        step: 'promo_display_name',
        data: { ...data, promoCode: code }
      })

      await sendMessage(user.id, `✅ <b>Code "${code}" accepted!</b>

━━━━━━━━━━━━━━━━━━━

Now enter a display name for this promo code (1-100 chars):

<i>Example: Summer Sale 2025</i>

━━━━━━━━━━━━━━━━━━━

Send /cancel to exit`)
      return
    }

    // Create promo code directly
    await createPromoCode(user, code, data)
    return
  }

  // Handle display name input
  if (state.step === 'promo_display_name') {
    if (trimmedText.length < 1 || trimmedText.length > 100) {
      await sendMessage(user.id, `❌ <b>Invalid Display Name</b>

━━━━━━━━━━━━━━━━━━━

Display name must be 1-100 characters.

Please try again or send /cancel to exit.`)
      return
    }

    const code = data.promoCode || ''
    await updateConversationData(userId, { promoDisplayName: trimmedText })

    // Create promo code
    const updatedState = await getConversationState(userId)
    if (updatedState) {
      await createPromoCode(user, code, updatedState.data)
    }
    return
  }
}
```

- [ ] **Step 2: Create promo code creator function**

Add after `handlePromoCreationTextInput`:

```typescript
/**
 * Create the promo code in database
 */
async function createPromoCode(user: TelegramUser, code: string, data: any): Promise<void> {
  // Validate required fields
  if (!data.promoPlanType) {
    throw new Error('promoPlanType is required')
  }

  try {
    // Create promo code
    const promo = await prisma.promoCode.create({
      data: {
        code: code.toLowerCase(), // Store as lowercase
        name: data.promoDisplayName || null,
        planType: data.promoPlanType,
        durationDays: data.promoDurationDays,
        hasCopierAccess: data.promoHasCopierAccess || false,
        isFree: data.promoIsFree,
        amountKobo: data.promoIsFree ? null : 0,
        expiresAt: data.promoExpiresAt,
        usageLimit: data.promoUsageLimit,
        usageCount: 0,
        perUserLimit: 1,
        isActive: true,
        createdBy: user.id.toString()
      }
    })

    // Clear conversation state
    await clearConversationState(user.id.toString())

    // Send success message
    const planNames = {
      basic: 'Basic',
      biweekly: 'Bi-Weekly',
      monthly: 'Monthly'
    }

    const durationText = data.promoDurationDays === 1 ? '1 day' : `${data.promoDurationDays} days`
    const priceText = data.promoIsFree ? 'FREE' : `₦${((data.amountKobo || 0) / 100).toLocaleString()}`
    const copierText = data.promoHasCopierAccess ? '✅ With Copier' : '❌ No Copier'
    const expiryText = data.promoExpiresAt?.getFullYear() === 2099 ? 'Never' : data.promoExpiresAt?.toLocaleDateString()
    const limitText = data.promoUsageLimit === null ? 'Unlimited' : `${data.promoUsageLimit} users`

    await sendMessage(user.id, `✅ <b>Promo Code Created Successfully!</b>

━━━━━━━━━━━━━━━━━━━

<b>📋 Code:</b> ${promo.code.toUpperCase()}
<b>📝 Name:</b> ${promo.name || 'No display name'}

<b>Plan:</b> ${planNames[promo.planType as keyof typeof planNames]}
<b>Duration:</b> ${durationText}
<b>Price:</b> ${priceText}
<b>Copier:</b> ${copierText}
<b>Expires:</b> ${expiryText}
<b>Usage Limit:</b> ${limitText}
<b>Per User:</b> Once

━━━━━━━━━━━━━━━━━━━

<b>🎯 Users can redeem with:</b>
/promo ${promo.code}

━━━━━━━━━━━━━━━━━━━

<i>💡 Codes are case-insensitive: /promo ${promo.code.toUpperCase()} or /promo ${promo.code}</i>`)

  } catch (error) {
    console.error('[Promo Creation] Failed to create promo code:', error)
    await sendMessage(user.id, `❌ <b>Failed to Create Promo Code</b>

━━━━━━━━━━━━━━━━━━━

An error occurred. Please try again.`)

    // Clear state on error
    await clearConversationState(user.id.toString())
  }
}
```

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit text input handlers**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "feat: add text input handlers for promo creation

- Add handlePromoCreationTextInput() for text input processing
- Handle custom duration and usage limit validation
- Validate code name format and uniqueness
- Prompt for display name if needed
- Add createPromoCode() to save to database
- Store codes as lowercase for case-insensitive redemption
- Send detailed confirmation message

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 5: Wire Up Callback Handler and Update Command Routing

### Task 5: Update Callback Query Handler

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Find callback handler location**

Search for line with `if (body.callback_query)` around line 4182

- [ ] **Step 2: Add promo callback handler routing**

The callback query handler extracts data from the callback_query object. At the top of the callback handler you'll see:

```typescript
if (body.callback_query) {
  const { callback_query } = body
  const { id, from, data, message } = callback_query
  // ... rest of handler
```

Add the promo handler routing after MT5 callback handler (around line 4208-4211):

```typescript
// Handle promo creation callbacks
if (data.startsWith('promo_')) {
  await handlePromoButtonCallback(from, id, data, message?.message_id || 0)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Update command handler to use new function**

Find the `case '/create_promo':` handler (around line 4877-4879) and replace:

```typescript
case '/create_promo':
  await handleCreatePromoV2(from)  // Use new version
  break
```

- [ ] **Step 4: Add conversation state check for text input**

Find the conversation state check (around line 4605-4615) and update to include new promo creation flow:

```typescript
// Check if user is in conversation flow
const conversationState = await getConversationState(userId)
if (conversationState && !command.startsWith('/')) {
  // Check if it's new promo creation flow
  if (['promo_selections', 'promo_custom_duration', 'promo_custom_usage', 'promo_display_name'].includes(conversationState.step)) {
    await handlePromoCreationTextInput(from, text)
    return NextResponse.json({ ok: true })
  }

  // Check if it's old promo conversation step (deprecated)
  const promoSteps = ['promo_code', 'promo_name', 'plan_type', 'duration', 'is_free', 'has_copier', 'amount', 'expiry']
  if (promoSteps.includes(conversationState.step)) {
    await handlePromoConversation(from, text)
    return NextResponse.json({ ok: true })
  }

  // ... rest of conversation handling
}
```

- [ ] **Step 5: Add cancel handler for new flow**

Add to cancel command handler (search for `case '/cancel':`):

```typescript
case '/cancel':
  const cancelState = await getConversationState(userId)
  if (cancelState) {
    // Clear state
    await clearConversationState(userId)
    await sendMessage(from.id, `✅ Promo code creation cancelled.`)
  }
  break
```

- [ ] **Step 6: Verify compilation**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 7: Commit wiring changes**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "feat: wire up promo creation callback and command handlers

- Route promo_ callbacks to handlePromoButtonCallback
- Update /create_promo to use handleCreatePromoV2
- Add conversation state check for new promo flow
- Handle text input for custom values and code name
- Add cancel handler for new flow
- Support both old and new flows during transition

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 6: Fix Case-Sensitivity Bug in Redemption

### Task 6: Update Promo Redemption Logic

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Update redeemPromoCode to support case-insensitive search**

Find the `redeemPromoCode` function (around line 1796) and update the database lookup section:

```typescript
async function redeemPromoCode(user: TelegramUser, promoCodeInput: string): Promise<void> {
  const userId = user.id.toString()
  const code = promoCodeInput.trim().toLowerCase()

  // 1. Check if promo code exists in database (exact match - lowercase)
  let promo = await prisma.promoCode.findUnique({
    where: { code: code }
  })

  // 2. If not found, try case-insensitive search for backward compatibility
  if (!promo && code !== promoCodeInput.trim()) {
    promo = await prisma.promoCode.findFirst({
      where: {
        code: {
          equals: code,
          mode: 'insensitive'
        }
      }
    })
  }

  if (!promo) {
    await sendMessage(user.id, `❌ <b>Invalid Promo Code</b>

The promo code "${promoCodeInput}" doesn't exist.

Please check the code and try again, or contact admin.`)
    return
  }

  // ... rest of validation continues unchanged
```

- [ ] **Step 2: Test compilation**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit bug fix**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: add case-insensitive promo code search for backward compatibility

- Try exact lowercase match first (new codes)
- Fall back to case-insensitive search (old uppercase codes)
- Ensures both old and new promo codes work
- Users can type codes in any case
- Fixes critical redemption bug

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 7: Testing and Verification

### Task 7: Manual Testing Checklist

**No code changes - manual verification**

- [ ] **Step 1: Start development server**

```bash
npm run dev
```

- [ ] **Step 2: Test promo creation flow**

1. Send `/create_promo` to bot as admin
2. Verify keyboard appears with 7 rows of buttons
3. Click each button type and verify no errors
4. Select all required options:
   - Plan type (Basic)
   - Duration (7 days)
   - Price (FREE)
   - Copier (No)
   - Display Name (Skip)
   - Expiry (90 days)
   - Usage Limit (Unlimited)
5. Verify bot prompts for code name
6. Enter code: `test123`
7. Verify success message and code details

- [ ] **Step 3: Test custom values**

1. Send `/create_promo`
2. Click ✏️ Custom on Duration
3. Verify bot asks for number
4. Enter `15`
5. Verify confirmation message
6. Complete other selections
7. Verify code created with 15 days duration

- [ ] **Step 4: Test display name flow**

1. Send `/create_promo`
2. Complete selections with "✅ Add Name"
3. Enter code: `summer2025`
4. Verify bot asks for display name
5. Enter: `Summer Sale 2025`
6. Verify success message shows display name

- [ ] **Step 5: Test validation errors**

1. Try to create duplicate code → Error message
2. Enter invalid code format (with spaces) → Error message
3. Enter invalid custom duration (0, 400) → Error message
4. Enter invalid custom usage (0, 2000) → Error message

- [ ] **Step 6: Test cancel flow**

1. Send `/create_promo`
2. Make some selections
3. Send `/cancel`
4. Verify state cleared and cancellation message

- [ ] **Step 7: Test redemption case-insensitivity**

1. Create code: `test123`
2. Try `/promo test123` → Should work
3. Try `/promo TEST123` → Should work
4. Try `/promo TeSt123` → Should work
5. Verify all three create subscriptions in database

- [ ] **Step 8: Test database**

1. Check Prisma Studio or MongoDB:
   ```bash
   npx prisma studio
   ```
2. Verify new codes stored as lowercase
3. Verify all fields populated correctly
4. Verify usageCount starts at 0

- [ ] **Step 9: Test with admin ID only**

1. Use non-admin Telegram account
2. Send `/create_promo`
3. Verify "Only admin can use this command" error

- [ ] **Step 10: Performance check**

1. Time how long it takes to create a promo code
2. Should be under 30 seconds from start to finish
3. Verify no lag between button clicks

---

## Chunk 8: Final Cleanup and Documentation

### Task 8: Remove Old Promo Creation Flow

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Remove old handler functions**

Delete or comment out:
- `handleCreatePromo` (old version, line ~2771)
- `handlePromoConversation` (line ~2896)

- [ ] **Step 2: Remove old conversation state types**

From `src/lib/conversation-state.ts`:
- Remove `PromoStep` type (or mark as deprecated)
- Remove old promo fields from interface in future cleanup

- [ ] **Step 3: Update error handling**

Remove old promo steps from conversation state check:

```typescript
// Remove these lines
const promoSteps = ['promo_code', 'promo_name', 'plan_type', 'duration', 'is_free', 'has_copier', 'amount', 'expiry']
if (promoSteps.includes(conversationState.step)) {
  // This entire block can be removed
}
```

- [ ] **Step 4: Test after cleanup**

```bash
npm run build
npm run dev
```

- [ ] **Step 5: Commit cleanup**

```bash
git add src/app/api/telegram/webhook/route.ts src/lib/conversation-state.ts
git commit -m "chore: remove deprecated promo creation flow

- Remove old handleCreatePromo function
- Remove handlePromoConversation function
- Clean up old conversation state checks
- New inline keyboard flow is now the only method

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 9: Final Verification and Deployment

### Task 9: Pre-Deployment Checks

- [ ] **Step 1: Build project**

```bash
npm run build
```

Expected: No build errors

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

Expected: No TypeScript errors

- [ ] **Step 3: Run linter**

```bash
npm run lint
```

Expected: No lint errors (or fix any that appear)

- [ ] **Step 4: Check database migration status**

```bash
npx prisma migrate status
```

Expected: All migrations applied

- [ ] **Step 5: Generate Prisma client**

```bash
npx prisma generate
```

- [ ] **Step 6: Review git diff**

```bash
git diff main
```

Verify all changes are intentional

- [ ] **Step 7: Create summary commit**

```bash
git add -A
git commit -m "feat: complete admin promo code creation UI redesign

This implementation replaces the 7-step conversation flow with
an inline keyboard interface for faster, more intuitive promo
code creation by admins.

Key features:
- Inline keyboard with 7 rows of buttons (all options visible)
- Real-time state tracking in MongoDB
- Custom value support for duration and usage limits
- Optional display name for promo codes
- Case-insensitive promo code redemption
- Backward compatibility with existing uppercase codes

Bug fixes:
- Fixed case-sensitivity bug in promo code redemption
- Store new codes as lowercase for consistent searching

Tech stack:
- Next.js 14, TypeScript, Prisma ORM, MongoDB
- Telegram Bot API with inline keyboards

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 8: Push to repository**

```bash
git push origin main
```

---

## Success Criteria

✅ All tasks completed with green checkmarks
✅ TypeScript compilation passes without errors
✅ Build completes successfully
✅ Admin can create promo code in under 30 seconds
✅ All button combinations work correctly
✅ Custom values validate properly
✅ Display name collection works
✅ Cancel flow clears state
✅ Codes stored as lowercase in database
✅ Case-insensitive redemption works
✅ Error messages are clear and helpful
✅ Non-admins cannot access creation flow
✅ Existing uppercase promo codes still work

---

## Rollback Plan

If critical issues are found in production:

1. Revert to previous commit:
   ```bash
   git revert HEAD
   git push origin main
   ```

2. Or restore from backup:
   ```bash
   git reset --hard <previous-commit-hash>
   git push --force origin main
   ```

3. Database migrations can be rolled back:
   ```bash
   npx prisma migrate resolve --rolled-back [migration-name]
   ```

---

## Future Enhancements (Out of Scope)

- Add visual feedback (✅ indicators) on selected buttons
- Support editing existing promo codes
- Add promo code usage analytics dashboard
- Bulk promo code creation from CSV
- Promo code expiration notifications
- Duplicate promo code detection suggestions
- Promo code performance metrics
