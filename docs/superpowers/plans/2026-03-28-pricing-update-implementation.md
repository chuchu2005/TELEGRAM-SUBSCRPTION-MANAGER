# Pricing Update Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update subscription plan pricing from current rates to new rates (Basic: ₦5,000→₦10,000, Bi-Weekly: ₦9,000→₦17,000, Monthly: ₦18,000→₦35,000)

**Architecture:** Direct text replacement of pricing values in configuration files and UI display strings. No architectural changes needed - pricing is already centralized in config.ts for calculations.

**Tech Stack:** TypeScript, Next.js API routes, Telegram Bot API, Paystack API

---

## File Structure

### Files to Modify

1. **`src/lib/config.ts`** - Core pricing configuration (PLANS object)
2. **`src/app/api/telegram/webhook/route.ts`** - UI display strings for plan selection and pricing
3. **`TESTING_CHECKLIST.md`** - Documentation with pricing examples
4. **`src/lib/paystack.ts`** - Paystack fee comments (optional)

---

## Chunk 1: Update Core Configuration

### Task 1: Update Basic Plan Pricing

**Files:**
- Modify: `src/lib/config.ts:6`

- [ ] **Step 1: Read current config to verify structure**

```bash
cat src/lib/config.ts | head -20
```
Expected: Shows PLANS object with basic plan at line 6

- [ ] **Step 2: Update Basic plan amountKobo and comment**

Using Edit tool, replace line 6:
```typescript
amountKobo: 1000000,  // NGN 10,000
```

- [ ] **Step 3: Verify the change**

```bash
grep -A 2 "basic:" src/lib/config.ts
```
Expected: Shows `amountKobo: 1000000,  // NGN 10,000`

- [ ] **Step 4: Commit configuration change**

```bash
git add src/lib/config.ts
git commit -m "feat: update Basic plan pricing to ₦10,000"
```

---

### Task 2: Update Bi-Weekly Plan Pricing

**Files:**
- Modify: `src/lib/config.ts:12`

- [ ] **Step 1: Update Bi-Weekly plan amountKobo and comment**

Using Edit tool, replace line 12:
```typescript
amountKobo: 1700000,  // NGN 17,000
```

- [ ] **Step 2: Verify the change**

```bash
grep -A 2 "biweekly:" src/lib/config.ts
```
Expected: Shows `amountKobo: 1700000,  // NGN 17,000`

- [ ] **Step 3: Commit configuration change**

```bash
git add src/lib/config.ts
git commit -m "feat: update Bi-Weekly plan pricing to ₦17,000"
```

---

### Task 3: Update Monthly Plan Pricing

**Files:**
- Modify: `src/lib/config.ts:18`

- [ ] **Step 1: Update Monthly plan amountKobo and comment**

Using Edit tool, replace line 18:
```typescript
amountKobo: 3500000,  // NGN 35,000
```

- [ ] **Step 2: Verify the change**

```bash
grep -A 2 "monthly:" src/lib/config.ts
```
Expected: Shows `amountKobo: 3500000,  // NGN 35,000`

- [ ] **Step 3: Commit configuration change**

```bash
git add src/lib/config.ts
git commit -m "feat: update Monthly plan pricing to ₦35,000"
```

---

## Chunk 2: Update Telegram Bot UI Display

### Task 4: Update Plan Selection Menu - Basic Plan Display

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Locate the plan selection message**

```bash
grep -n "₦5,000" src/app/api/telegram/webhook/route.ts | grep -i basic
```
Expected: Shows line with "💎 <b>Basic Plan</b> - ₦5,000"

- [ ] **Step 2: Update Basic plan display price**

Using Edit tool with the pattern from grep output, replace:
```typescript
💎 <b>Basic Plan</b> - ₦10,000
```

- [ ] **Step 3: Verify the change**

```bash
grep "Basic Plan" src/app/api/telegram/webhook/route.ts | grep "₦10,000" | head -1
```
Expected: Shows "💎 <b>Basic Plan</b> - ₦10,000"

- [ ] **Step 4: Commit UI change**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: update Basic plan display to ₦10,000"
```

---

### Task 5: Update Plan Selection Menu - Bi-Weekly Trial Price

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Locate Bi-Weekly trial discount line**

```bash
grep -n "₦9,000\|₦4,500" src/app/api/telegram/webhook/route.ts | grep -i bi-weekly
```
Expected: Shows line with Bi-Weekly VIP pricing and trial

- [ ] **Step 2: Update Bi-Weekly trial discount display**

Using Edit tool, find and replace:
```typescript
📊 <b>Bi-Weekly VIP</b> - ${trialEligible ? '₦8,500' : '₦17,000'} ${trialEligible ? '<s>(was ₦17,000)</s>' : ''}
```

- [ ] **Step 3: Verify the change**

```bash
grep -i "bi-weekly vip" src/app/api/telegram/webhook/route.ts | grep "₦17,000\|₦8,500" | head -1
```
Expected: Shows trial price ₦8,500 and regular price ₦17,000

- [ ] **Step 4: Commit UI change**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: update Bi-Weekly trial display to ₦8,500/₦17,000"
```

---

### Task 6: Update Plan Selection Menu - Monthly Trial Price

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Locate Monthly trial discount line**

```bash
grep -n "₦18,000\|₦9,000" src/app/api/telegram/webhook/route.ts | grep -i monthly
```
Expected: Shows line with Monthly VIP pricing and trial

- [ ] **Step 2: Update Monthly trial discount display**

Using Edit tool, find and replace:
```typescript
📅 <b>Monthly VIP</b> - ${trialEligible ? '₦17,500' : '₦35,000'} ${trialEligible ? '<s>(was ₦35,000)</s>' : ''}
```

- [ ] **Step 3: Verify the change**

```bash
grep -i "monthly vip" src/app/api/telegram/webhook/route.ts | grep "₦35,000\|₦17,500" | head -1
```
Expected: Shows trial price ₦17,500 and regular price ₦35,000

- [ ] **Step 4: Commit UI change**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: update Monthly trial display to ₦17,500/₦35,000"
```

---

### Task 7: Update Plan Selection Buttons

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts:425,428,431`

- [ ] **Step 1: Update Basic plan button text**

Using Edit tool, replace line 425:
```typescript
{ text: '💎 Basic Plan - ₦10,000', callback_data: 'pay_basic' }
```

- [ ] **Step 2: Update Bi-Weekly plan button text**

Using Edit tool, replace line 428:
```typescript
{ text: '📊 Bi-Weekly VIP - ₦17,000', callback_data: 'pay_biweekly' }
```

- [ ] **Step 3: Update Monthly plan button text**

Using Edit tool, replace line 431:
```typescript
{ text: '📅 Monthly VIP - ₦35,000', callback_data: 'pay_monthly' }
```

- [ ] **Step 4: Verify all button changes**

```bash
sed -n '425,431p' src/app/api/telegram/webhook/route.ts
```
Expected: Shows all three buttons with updated prices

- [ ] **Step 5: Commit button changes**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: update plan button pricing"
```

---

### Task 8: Update Quick Pay Display

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts:655,656,657`

- [ ] **Step 1: Update planNames object for Quick Pay**

Using Edit tool, replace lines 655-657:
```typescript
const planNames = {
  basic: 'Basic Plan (₦10,000)',
  biweekly: 'Bi-Weekly VIP (₦17,000)',
  monthly: 'Monthly VIP (₦35,000)'
}
```

- [ ] **Step 2: Verify the change**

```bash
sed -n '654,658p' src/app/api/telegram/webhook/route.ts
```
Expected: Shows updated planNames object

- [ ] **Step 3: Commit Quick Pay changes**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: update Quick Pay pricing display"
```

---

### Task 9: Update Alternative Pricing Display

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Update Basic plan alternative display**

Using Edit tool, find and replace:
```typescript
💎 <b>Basic Plan</b> - ₦10,000
```

- [ ] **Step 2: Update Bi-Weekly plan alternative display**

Using Edit tool, find and replace:
```typescript
📊 <b>Bi-Weekly VIP</b> - ₦17,000
```

- [ ] **Step 3: Update Monthly plan alternative display**

Using Edit tool, find and replace:
```typescript
📅 <b>Monthly VIP</b> - ₦35,000
```

- [ ] **Step 4: Verify all alternative display changes**

```bash
grep -E "Basic Plan|Bi-Weekly VIP|Monthly VIP" src/app/api/telegram/webhook/route.ts | grep -E "₦[0-9,]+"
```
Expected: Shows all plan displays with updated prices

- [ ] **Step 5: Commit alternative display changes**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: update alternative pricing display"
```

---

### Task 9a: Update Referral Program Pricing

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Find referral program pricing references**

```bash
grep -n "₦18,000 Monthly plan" src/app/api/telegram/webhook/route.ts
```
Expected: Shows line with referral program pricing

- [ ] **Step 2: Update referral program pricing**

Using Edit tool, replace "₦18,000 Monthly plan" with "₦35,000 Monthly plan"

- [ ] **Step 3: Verify the change**

```bash
grep -n "Monthly plan" src/app/api/telegram/webhook/route.ts
```
Expected: Shows updated pricing

- [ ] **Step 4: Commit referral pricing change**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: update referral program pricing"
```

---

### Task 9b: Update Additional Plan Display Sections

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Find additional plan pricing displays**

```bash
grep -n -E "Basic: ₦5,000|Bi-Weekly: ₦9,000|Monthly: ₦18,000" src/app/api/telegram/webhook/route.ts
```
Expected: Shows lines with additional plan pricing displays

- [ ] **Step 2: Update all additional plan displays**

Using Edit tool, replace each occurrence:
- "Basic: ₦5,000" → "Basic: ₦10,000"
- "Bi-Weekly: ₦9,000" → "Bi-Weekly: ₦17,000"
- "Monthly: ₦18,000" → "Monthly: ₦35,000"

- [ ] **Step 3: Verify all changes**

```bash
grep -E "Basic: |Bi-Weekly: |Monthly: " src/app/api/telegram/webhook/route.ts | grep "₦[0-9,]+"
```
Expected: All instances show updated prices

- [ ] **Step 4: Commit additional display changes**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: update additional plan pricing displays"
```

---

### Task 9c: Update Pay Button Text

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Find pay button references**

```bash
grep -n -E "Pay ₦5,000|Pay ₦9,000|Pay ₦18,000" src/app/api/telegram/webhook/route.ts
```
Expected: Shows lines with pay button text

- [ ] **Step 2: Update pay button text**

Using Edit tool, replace each occurrence:
- "Pay ₦5,000 - Basic" → "Pay ₦10,000 - Basic"
- "Pay ₦9,000 - Bi-Weekly" → "Pay ₦17,000 - Bi-Weekly"
- "Pay ₦18,000 - Monthly" → "Pay ₦35,000 - Monthly"

- [ ] **Step 3: Verify all button text changes**

```bash
grep -E "Pay " src/app/api/telegram/webhook/route.ts | grep "₦[0-9,]+"
```
Expected: All button text shows updated prices

- [ ] **Step 4: Commit button text changes**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: update pay button pricing"
```

---

### Task 9d: Update Subscription Renewal Messages

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Find subscription renewal messages**

```bash
grep -n -E "Bi-Weekly \(₦9,000\)|Monthly \(₦18,000\)" src/app/api/telegram/webhook/route.ts
```
Expected: Shows renewal message lines

- [ ] **Step 2: Update renewal pricing**

Using Edit tool, replace each occurrence:
- "Bi-Weekly (₦9,000)" → "Bi-Weekly (₦17,000)"
- "Monthly (₦18,000)" → "Monthly (₦35,000)"

- [ ] **Step 3: Verify renewal message changes**

```bash
grep -E "Bi-Weekly \(|Monthly \(" src/app/api/telegram/webhook/route.ts
```
Expected: Shows updated pricing

- [ ] **Step 4: Commit renewal message changes**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: update subscription renewal pricing"
```

---

### Task 9e: Update Admin Promo Code Help Text

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Find admin promo code help text**

```bash
grep -n -E "500,000 kobo|900,000 kobo|1,800,000 kobo" src/app/api/telegram/webhook/route.ts
```
Expected: Shows lines with admin help text and kobo values

- [ ] **Step 2: Update admin promo code pricing**

Using Edit tool, replace each occurrence:
- "500,000 kobo" → "1,000,000 kobo"
- "900,000 kobo" → "1,700,000 kobo"
- "1,800,000 kobo" → "3,500,000 kobo"

- [ ] **Step 3: Verify admin text changes**

```bash
grep -E "500,000 kobo|900,000 kobo|1,800,000 kobo|1,000,000 kobo|1,700,000 kobo|3,500,000 kobo" src/app/api/telegram/webhook/route.ts | head -10
```
Expected: Shows updated kobo values

- [ ] **Step 4: Commit admin text changes**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: update admin promo code help pricing"
```

---

### Task 9f: Update Verification Caption Pricing

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Find verification caption pricing**

```bash
grep -n "Verifying Basic (₦5,000) Payment\|Verifying Bi-Weekly (₦9,000) Payment\|Verifying Monthly (₦18,000) Payment" src/app/api/telegram/webhook/route.ts
```
Expected: Shows lines with verification captions

- [ ] **Step 2: Update verification caption pricing**

Using Edit tool, replace each occurrence:
- "Verifying Basic (₦5,000) Payment" → "Verifying Basic (₦10,000) Payment"
- "Verifying Bi-Weekly (₦9,000) Payment" → "Verifying Bi-Weekly (₦17,000) Payment"
- "Verifying Monthly (₦18,000) Payment" → "Verifying Monthly (₦35,000) Payment"

- [ ] **Step 3: Verify caption changes**

```bash
grep -E "Verifying.*Payment" src/app/api/telegram/webhook/route.ts | grep "₦[0-9,]+"
```
Expected: Shows updated pricing

- [ ] **Step 4: Commit caption changes**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: update verification caption pricing"
```

---

### Task 9g: Update Promo Plan Names Object

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Find promo planNames pricing**

```bash
grep -n "Basic (₦5,000)\|Bi-Weekly (₦9,000)\|Monthly (₦18,000)" src/app/api/telegram/webhook/route.ts | grep -A 2 -B 2 "planNames"
```
Expected: Shows lines with promo planNames and pricing

- [ ] **Step 2: Update promo planNames pricing**

Using Edit tool, replace each occurrence:
- "Basic (₦5,000)" → "Basic (₦10,000)"
- "Bi-Weekly (₦9,000)" → "Bi-Weekly (₦17,000)"
- "Monthly (₦18,000)" → "Monthly (₦35,000)"

- [ ] **Step 3: Verify planNames changes**

```bash
grep -A 10 "promo.*planNames\|planNames.*promo" src/app/api/telegram/webhook/route.ts | grep "₦[0-9,]+"
```
Expected: Shows updated pricing

- [ ] **Step 4: Commit planNames changes**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "fix: update promo planNames pricing"
```

---

### Task 9h: Update Web Payment Success Page

**Files:**
- Modify: `src/app/payment/success/page.tsx`

- [ ] **Step 1: Find outdated Premium pricing reference**

```bash
grep -n "₦22,000\|verify_premium" src/app/payment/success/page.tsx
```
Expected: Shows line 258 with outdated Premium reference

- [ ] **Step 2: Update or remove outdated reference**

Using Edit tool, replace "Or if you paid ₦22,000: /verify_premium YOUR_REFERENCE" with:
```typescript
Or if you paid ₦35,000: /verify_monthly YOUR_REFERENCE
```

- [ ] **Step 3: Verify the change**

```bash
grep -E "₦[0-9,]+|verify_" src/app/payment/success/page.tsx
```
Expected: Shows updated pricing and command

- [ ] **Step 4: Commit web page changes**

```bash
git add src/app/payment/success/page.tsx
git commit -m "fix: update payment success page pricing"
```

---

## Chunk 3: Update Documentation

### Task 10: Update Testing Checklist - Basic Plan References

**Files:**
- Modify: `TESTING_CHECKLIST.md:21,115,136,151,162,263`

- [ ] **Step 1: Update line 21 - Basic plan price**

Using Edit tool, replace line 21:
```markdown
💎 Basic Plan - ₦10,000
```

- [ ] **Step 2: Update line 115 - Basic plan price**

Using Edit tool, replace line 115:
```markdown
💎 Basic Plan - ₦10,000
```

- [ ] **Step 3: Update line 136 - Basic plan button**

Using Edit tool, replace line 136:
```markdown
[Two buttons: 💎 Pay ₦10,000 (Basic) and 👑 Pay ₦35,000 (Monthly)]
```

- [ ] **Step 4: Update line 151 - Basic plan button**

Using Edit tool, replace line 151:
```markdown
**Action:** Click "💎 Pay ₦10,000 (Basic)" button
```

- [ ] **Step 5: Update line 162 - Amount display**

Using Edit tool, replace line 162:
```markdown
- [ ] Amount is ₦10,000
```

- [ ] **Step 6: Update line 263 - Basic plan option**

Using Edit tool, replace line 263:
```markdown
💎 Basic (₦10,000) - 7 days
```

- [ ] **Step 7: Verify all Basic plan changes**

```bash
grep -n "₦10,000" TESTING_CHECKLIST.md
```
Expected: Shows multiple instances of ₦10,000

- [ ] **Step 8: Commit Basic plan documentation changes**

```bash
git add TESTING_CHECKLIST.md
git commit -m "docs: update Basic plan pricing in testing checklist"
```

---

### Task 11: Update Testing Checklist - Monthly/Premium Plan References

**Files:**
- Modify: `TESTING_CHECKLIST.md:26,119,236,264`

- [ ] **Step 1: Update line 26 - Premium to Monthly pricing**

Using Edit tool, replace line 26:
```markdown
👑 Monthly Plan - ₦35,000
```

- [ ] **Step 2: Update line 119 - Premium to Monthly pricing**

Using Edit tool, replace line 119:
```markdown
👑 Monthly Plan - ₦35,000
```

- [ ] **Step 3: Update line 236 - Verification command example**

Using Edit tool, replace line 236:
```markdown
**Action:** Pay ₦35,000 but use `/verify_basic REFERENCE`
```

- [ ] **Step 4: Update line 264 - Monthly plan option**

Using Edit tool, replace line 264:
```markdown
👑 Monthly (₦35,000) - 30 days
```

- [ ] **Step 5: Verify all Monthly plan changes**

```bash
grep -n "₦35,000" TESTING_CHECKLIST.md
```
Expected: Shows multiple instances of ₦35,000

- [ ] **Step 6: Commit Monthly plan documentation changes**

```bash
git add TESTING_CHECKLIST.md
git commit -m "docs: update Monthly plan pricing in testing checklist"
```

---

### Task 12: Update Paystack Fee Comments (Optional)

**Files:**
- Modify: `src/lib/paystack.ts:98-101`

- [ ] **Step 1: Update Paystack fee comments to reflect new pricing**

Using Edit tool, replace lines 98-101:
```typescript
 * - ₦10,000 Basic plan: ~₦200-300 fees
 * - ₦17,000 Bi-Weekly plan: ~₦400-500 fees
 * - ₦35,000 Monthly plan: ~₦800-900 fees
```

- [ ] **Step 2: Verify the change**

```bash
sed -n '98,101p' src/lib/paystack.ts
```
Expected: Shows updated fee comments with new pricing

- [ ] **Step 3: Commit Paystack comment changes**

```bash
git add src/lib/paystack.ts
git commit -m "docs: update Paystack fee comments for new pricing"
```

---

## Chunk 4: Verification

### Task 13: Verify Configuration Changes

**Files:**
- Read: `src/lib/config.ts`

- [ ] **Step 1: Verify all pricing updates in config**

```bash
grep -A 2 "^\s*basic:" src/lib/config.ts | grep "amountKobo"
grep -A 2 "^\s*biweekly:" src/lib/config.ts | grep "amountKobo"
grep -A 2 "^\s*monthly:" src/lib/config.ts | grep "amountKobo"
```
Expected: Shows amountKobo: 1000000, 1700000, 3500000 for basic, biweekly, monthly

- [ ] **Step 2: Check git status**

```bash
git log --oneline -5
```
Expected: Shows recent commits for pricing changes

---

### Task 14: Restart Application (Manual Step)

**Files:** None

- [ ] **Step 1: Stop the bot**

```bash
# Stop running bot process
# This is manual - user needs to stop the bot
```

- [ ] **Step 2: Restart the bot**

```bash
# Start bot with new configuration
# This is manual - user needs to restart the bot
```

---

### Task 15: Test Plan Selection in Telegram

**Files:** None (Manual verification)

- [ ] **Step 1: Send /start command to bot**

In Telegram, send `/start` to the bot

Expected: Bot responds with welcome message and plan options

- [ ] **Step 2: Verify displayed prices**

Check that Basic shows ₦10,000, Bi-Weekly shows ₦17,000, Monthly shows ₦35,000

Expected: All prices match new pricing structure

- [ ] **Step 3: Test trial upgrade discount**

Create a test trial user and verify 50% discount displays (₦5,000, ₦8,500, ₦17,500)

Expected: Trial discounts are 50% of new prices

---

### Task 16: Test Payment Flow

**Files:** None (Manual verification)

- [ ] **Step 1: Select Basic plan and initiate payment**

Click "Basic Plan - ₦10,000" button and go through payment flow

Expected: Paystack link shows ₦10,000

- [ ] **Step 2: Verify payment amount validation**

Check that payment validation accepts the new amount with fee tolerance

Expected: Payment succeeds with amount slightly higher due to Paystack fees

- [ ] **Step 3: Test Bi-Weekly and Monthly payment flows**

Repeat for Bi-Weekly (₦17,000) and Monthly (₦35,000)

Expected: All payment flows work correctly with new pricing

---

### Task 17: Final Verification and Documentation

**Files:** None

- [ ] **Step 1: Review all commits**

```bash
git log --oneline --all
```
Expected: Shows all pricing update commits

- [ ] **Step 2: Create summary commit**

```bash
git commit --allow-empty -m "feat: complete pricing update to new rates

- Basic: ₦5,000 → ₦10,000
- Bi-Weekly: ₦9,000 → ₦17,000
- Monthly: ₦18,000 → ₦35,000
- All UI displays updated
- Testing documentation updated
"
```

- [ ] **Step 3: Verify no old pricing in source files**

```bash
# Check for old naira prices
grep -r "₦5,000\|₦9,000\|₦18,000\|₦22,000" src/ --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx"
```
Expected: No results (all old regular prices have been updated)

- [ ] **Step 4: Verify no old pricing in kobo format**

```bash
# Check for old kobo values
grep -r "amountKobo: 500000\|amountKobo: 900000\|amountKobo: 1800000\|amountKobo: 2200000" src/ --include="*.ts" --include="*.tsx"
```
Expected: No results (all old kobo values have been updated)

- [ ] **Step 5: Verify no old trial prices**

```bash
# Check for old trial discount prices (searching in trial-specific contexts to avoid false positives)
grep -r "₦2,500\|₦4,500" src/ --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx"
```
Expected: No results (old trial prices updated)
Note: ₦9,000 is now a valid Bi-Weekly regular price, so we only search for ₦2,500 and ₦4,500 which are old trial prices

---

## Rollback Procedure (If Issues Occur)

If problems are found after deployment:

```bash
# Rollback by reverting pricing commits
git revert HEAD~20..HEAD

# Restart bot with old pricing
# Verify old pricing is displayed

# Verification of successful rollback
grep -A 2 "^\s*basic:" src/lib/config.ts | grep "amountKobo"
# Should show: amountKobo: 500000
```

---

## Testing Checklist After Implementation

- [ ] Bot displays correct prices in /start message
- [ ] Bot displays correct trial discount prices (50% off)
- [ ] Payment flow generates correct Paystack amounts
- [ ] Payment validation accepts new amounts with fee tolerance
- [ ] Expiry reminders show correct pricing
- [ ] Quick Pay flow displays correct prices
- [ ] No old pricing values remain in codebase
