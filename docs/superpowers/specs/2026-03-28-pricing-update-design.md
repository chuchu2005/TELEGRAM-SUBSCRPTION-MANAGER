# Pricing Update Design

## Overview
Update subscription plan pricing to new rates across the Telegram subscription manager.

## New Pricing Structure

| Plan | Old Price | New Price | Duration |
|------|-----------|-----------|----------|
| Basic VIP | ₦5,000 | ₦10,000 | 7 days |
| Bi-Weekly VIP | ₦9,000 | ₦17,000 | 14 days |
| Monthly VIP | ₦18,000 | ₦35,000 | 30 days |

### Trial Discount Pricing (50% off)
| Plan | Trial Price |
|------|-------------|
| Basic | ₦5,000 |
| Bi-Weekly | ₦8,500 |
| Monthly | ₦17,500 |

## Implementation Approach
Direct text replacement of all pricing values in source files.

## Files to Modify

### 1. Core Configuration
**File:** `src/lib/config.ts`

Updates:
- Line 6: `amountKobo: 500000` → `1000000` (Basic)
- Line 12: `amountKobo: 900000` → `1700000` (Bi-Weekly)
- Line 18: `amountKobo: 1800000` → `3500000` (Monthly)
- Update inline comments with new naira values

### 2. UI Display - Plan Selection
**File:** `src/app/api/telegram/webhook/route.ts`

Updates:
- Line 378: `₦5,000` → `₦10,000`
- Line 384: `₦4,500/₦9,000` → `₦8,500/₦17,000` (with trial)
- Line 390: `₦9,000/₦18,000` → `₦17,500/₦35,000` (with trial)
- Line 425: `₦5,000` → `₦10,000` (button)
- Line 428: `₦9,000` → `₦17,000` (button)
- Line 431: `₦18,000` → `₦35,000` (button)
- Line 655: `₦5,000` → `₦10,000` (quick pay)
- Line 656: `₦9,000` → `₦17,000` (quick pay)
- Line 657: `₦18,000` → `₦35,000` (quick pay)
- Line 910: `₦5,000` → `₦10,000`
- Line 915: `₦9,000` → `₦17,000`
- Line 920: `₦18,000` → `₦35,000`

### 3. UI Display - Expiry Reminders
**File:** `src/app/api/cron/remove-expired/route.ts`

No hardcoded changes needed. Lines 199-201 and 220-222 use `PLANS` object dynamically and will update automatically.

### 4. Documentation - Testing
**File:** `TESTING_CHECKLIST.md`

Updates:
- Line 21: `₦5,000` → `₦10,000`
- Line 26: `₦22,000` → `₦35,000` (update Premium to Monthly pricing)
- Line 115: `₦5,000` → `₦10,000`
- Line 119: `₦22,000` → `₦35,000`
- Line 136: `₦5,000` → `₦10,000`
- Line 151: `₦5,000` → `₦10,000`
- Line 162: `₦5,000` → `₦10,000`
- Line 236: `₦22,000` → `₦35,000`
- Line 263: `₦5,000` → `₦10,000`
- Line 264: `₦22,000` → `₦35,000`

### 5. Paystack Comments (Optional)
**File:** `src/lib/paystack.ts`

Updates:
- Lines 98-101: Update comments to reflect new pricing tiers
- Tolerance of ₦1,500 (line 111) remains appropriate

## Verification Strategy

After implementing changes:

1. **Restart the bot** to load new configuration
2. **Test plan selection menu** - Verify displayed prices
3. **Test payment flow** - Generate Paystack link and verify correct amount
4. **Test trial upgrade discount** - Verify 50% discount displays correctly
5. **Test expiry reminders** - Trigger cron job and verify renewal pricing
6. **Verify Paystack integration** - Ensure payment validation works with new amounts

## Risk Assessment

**Low Risk:**
- Simple numeric value updates
- Core logic remains unchanged
- Paystack integration uses config values

**Considerations:**
- Cached pricing displays in active user sessions
- Ensure all hardcoded strings are updated

## Notes

- Trial discount is calculated as 50% of plan price and will update automatically
- Paystack fee tolerance of ₦1,500 covers the new price ranges
- All changes are backward compatible with existing subscriptions
