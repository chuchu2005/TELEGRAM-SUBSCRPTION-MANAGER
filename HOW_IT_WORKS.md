# Payment Flow - How It Works

## Two Ways to Pay

### Method 1: Automatic Payment with Buttons (Recommended) ✅

#### User Experience:
1. User sends `/pay` to bot
2. Bot shows 2 buttons:
   - 💎 Pay NGN 5,000 (Basic)
   - 👑 Pay NGN 22,000 (Premium)
3. User clicks button → Opens in Telegram browser
4. User sees Paystack page with **ONLY bank transfer option**
5. User transfers money → Payment successful
6. **Bot automatically receives webhook** → Creates invite link → Sends to user
7. User clicks invite link → Joins channel

#### Behind the Scenes:
```
User sends /pay
    ↓
Bot calls /api/payment/link (creates Paystack transaction with metadata)
    ↓
Paystack returns authorization URL
    ↓
Bot shows inline keyboard buttons with payment links
    ↓
User clicks button → Opens Paystack payment page (bank transfer only)
    ↓
User completes payment
    ↓
Paystack sends webhook to https://app.learnrithm.com/api/webhooks/paystack
    ↓
Your webhook forwards or handles the event
    ↓
POST /api/paystack/webhook receives charge.success
    ↓
Extracts telegram_id and plan_type from metadata
    ↓
Creates invite link
    ↓
Saves subscription to database
    ↓
Sends invite link to user on Telegram
    ↓
User receives link automatically! ✅
```

---

### Method 2: Manual Verification (Backup)

#### User Experience:
1. User sends `/start`
2. Bot shows bank details
3. User transfers money manually to bank account
4. User copies reference from bank app
5. User sends `/verify_basic REFERENCE` to bot
6. Bot calls Paystack API to verify
7. Bot creates invite link and sends to user

---

## Technical Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      USER IN TELEGRAM                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ /pay
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   TELEGRAM WEBHOOK                          │
│  /api/telegram/webhook                                      │
│  • Receives /pay command                                     │
│  • Calls /api/payment/link for each plan                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ fetch
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  PAYMENT LINK API                           │
│  /api/payment/link                                          │
│  • Creates Paystack transaction                             │
│  • Adds metadata (telegram_id, plan_type)                   │
│  • Sets channels: ['bank_transfer']                         │
│  • Returns authorization URL                                │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Returns payment URL
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      USER CLICKS BUTTON                      │
│  • Opens Telegram in-app browser                            │
│  • Shows Paystack payment page                              │
│  • Only bank transfer option                                │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ User completes payment
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     PAYSTACK                                 │
│  • Processes payment                                        │
│  • Sends webhook to your domain                             │
│  • Includes all metadata                                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ webhook: charge.success
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   PAYSTACK WEBHOOK                           │
│  /api/paystack/webhook                                       │
│  • Verifies signature                                       │
│  • Extracts telegram_id from metadata                       │
│  • Checks if already processed                              │
│  • Unbans user if previously removed                         │
│  • Creates invite link                                      │
│  • Saves subscription to MongoDB                            │
│  • Sends invite link to user on Telegram                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ sendMessage
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    USER RECEIVES LINK                        │
│  ✅ Payment Verified Successfully!                          │
│  👉 https://t.me/+invite_link                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Metadata Flow

### Payment Link Creation (`/api/payment/link`)
```json
{
  "email": "user_5472144783@telegram-bot.tmp",
  "amount": 500000,
  "channels": ["bank_transfer"],
  "metadata": {
    "product": "telegram_bot_subscription",
    "plan_type": "basic",
    "telegram_id": "5472144783",
    "telegram_username": "john_doe",
    "plan_name": "Basic VIP",
    "custom_fields": [
      {
        "display_name": "Plan Type",
        "variable_name": "plan_type",
        "value": "basic"
      },
      {
        "display_name": "Telegram ID",
        "variable_name": "telegram_id",
        "value": "5472144783"
      }
    ]
  }
}
```

### Webhook Reception (`/api/paystack/webhook`)
```json
{
  "event": "charge.success",
  "data": {
    "reference": "paystack_abc123",
    "amount": 500000,
    "metadata": {
      "telegram_id": "5472144783",
      "plan_type": "basic"
    }
  }
}
```

---

## Files Created/Modified

### New Files:
1. `/api/payment/link/route.ts` - Creates Paystack payment links with metadata
2. `/payment/success/page.tsx` - Success page after payment
3. `/api/payment/callback/route.ts` - Payment callback handler

### Modified Files:
1. `/api/telegram/webhook/route.ts` - Added `/pay` command
2. `/api/paystack/webhook/route.ts` - Auto-process payments with metadata
3. `/lib/telegram.ts` - Added inline keyboard support

---

## Testing the Flow

### Step 1: Start your dev server
```bash
npm run dev
```

### Step 2: In Telegram, send to your bot:
```
/pay
```

### Step 3: Click one of the buttons
- Try the NGN 5,000 button (Basic)
- Should open in Telegram browser
- Should show only bank transfer option

### Step 4: Make a test payment
- Transfer to the account shown
- Wait for webhook
- You should automatically receive invite link!

---

## Important Notes

1. **Your existing webhook** (`https://app.learnrithm.com/api/webhooks/paystack`) will receive the notification
2. **You need to forward or handle** payments with `product: "telegram_bot_subscription"` in metadata
3. **Or** add this bot's webhook URL as a second webhook in Paystack
4. **Manual verification** still works as backup with `/verify_basic REF`

---

## Commands Summary

| Command | Description |
|---------|-------------|
| `/start` | Welcome message with all options |
| `/pay` | Get payment buttons (automatic) ✅ |
| `/verify_basic REF` | Manual verification |
| `/verify_premium REF` | Manual verification |
| `/status` | Check subscription status |
| `/help` | Show help message |

---

## Webhook Configuration

Since you're using the same Paystack account for multiple projects:

### Option 1: Filter in Your Existing Webhook
Add this to your `app.learnrithm.com` webhook:
```javascript
if (event.data.metadata?.product === 'telegram_bot_subscription') {
  // Forward to bot API or process here
  await processTelegramBotPayment(event.data)
}
```

### Option 2: Add Second Webhook in Paystack Dashboard
Paystack supports multiple webhook URLs. Add:
- `https://app.learnrithm.com/api/webhooks/paystack` (your SaaS)
- `https://your-bot-domain.com/api/paystack/webhook` (this bot)

Both will receive notifications.

---

Done! 🎉
