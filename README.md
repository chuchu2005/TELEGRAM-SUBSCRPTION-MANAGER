# Telegram Payment Bot with Paystack Integration

A fully automated Telegram bot system that allows users to pay via Paystack, get verified, and gain access to a private Telegram channel. Users are automatically removed after their subscription expires.

## Features

- **Two Subscription Plans:**
  - 💎 **Basic Plan:** NGN 5,000 for 7 days (VIP group access)
  - 👑 **Premium Plan:** NGN 22,000 for 14 days (VIP group + Auto Copier Bot access)

- **Automated Workflows:**
  - Payment verification via Paystack API
  - Automatic invite link generation
  - Auto-removal of expired users (hourly cron job)
  - Automatic unban for returning users who repay

- **Security:**
  - Reference uniqueness check (prevent double redemption)
  - Rate limiting (5 failed attempts = 1 hour block)
  - Webhook signature verification
  - Protected cron endpoints

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** MongoDB with Prisma ORM
- **Payment:** Paystack API
- **Bot:** Telegram Bot API (raw HTTP fetch)
- **Deployment:** Vercel with Cron Jobs

## Prerequisites

1. Node.js 18+ installed
2. MongoDB Atlas account
3. Paystack account
4. Telegram account (to create bot)

## Setup Instructions

### 1. Create Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` command
3. Follow prompts to name your bot and get a token
4. Copy the bot token (format: `123456:ABC-DEF...`)

### 2. Set Bot Commands

In BotFather, send `/setcommands`, select your bot, and paste:

```
start - Welcome message and payment instructions
verify_basic - Verify Basic plan payment (NGN 5,000, 7 days)
verify_premium - Verify Premium plan payment (NGN 22,000, 14 days + copier)
status - Check your current subscription status
help - Show help and payment instructions
```

### 3. Get Channel ID

1. Forward a message from your private channel to [@userinfobot](https://t.me/userinfobot)
2. Note the channel ID (format: `-100xxxxxxxxxx`)
3. Add your bot as an administrator to the channel with permissions:
   - ✅ Invite users via link
   - ✅ Restrict members

### 4. Get Paystack Credentials

1. Log in to [Paystack Dashboard](https://dashboard.paystack.co/)
2. Go to Settings → API Keys
3. Copy your Secret Key (starts with `sk_live_` or `sk_test_`)

### 5. Set Up MongoDB

1. Create a free account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a new cluster (M0 free tier works)
3. Create a database user
4. Whitelist IP `0.0.0.0/0` (for Vercel)
5. Copy the connection string

### 6. Install and Configure

```bash
# Clone or navigate to your project
cd vipbot

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local
```

### 7. Configure Environment Variables

Edit `.env.local` with your credentials:

```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_CHANNEL_ID=your_channel_id

# Paystack Configuration
PAYSTACK_SECRET_KEY=sk_live_your_paystack_secret_key

# Database Configuration
DATABASE_URL=mongodb+srv://username:password@cluster.mongodb.net/database

# Cron Security
CRON_SECRET=generate_a_random_secret_string_here

# Application Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 8. Initialize Database

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database (for MongoDB, use db push)
npx prisma db push
```

### 9. Run Locally

```bash
npm run dev
```

The bot will run on `http://localhost:3000`

### 10. Set Webhook

Once deployed, set your bot's webhook:

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://your-domain.com/api/telegram/webhook"
```

Or visit in browser:
```
https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://your-domain.com/api/telegram/webhook
```

## Deployment

### Deploy to Vercel

1. Push your code to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add all environment variables from `.env.local`
4. Deploy
5. Cron jobs are automatically configured from `vercel.json`

### Required Environment Variables in Vercel

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHANNEL_ID`
- `PAYSTACK_SECRET_KEY`
- `DATABASE_URL`
- `CRON_SECRET`
- `NEXT_PUBLIC_APP_URL`

## How It Works

### User Flow

1. User sends `/start` to bot to see payment details
2. User makes payment to Paystack account
3. User copies transaction reference
4. User sends `/verify_basic REF` or `/verify_premium REF`
5. Bot verifies payment with Paystack API
6. Bot checks reference hasn't been used
7. Bot checks payment amount matches plan
8. Bot checks if user was previously banned and unbans them
9. Bot creates one-time invite link
10. Bot saves subscription to database
11. User joins channel with invite link

### Cron Job Flow (Every Hour)

1. Checks for expired subscriptions
2. Bans/removes expired users from channel
3. Marks subscription as removed in database
4. Sends expiry notification to user

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message and payment instructions |
| `/verify_basic <ref>` | Verify Basic plan payment (NGN 5,000, 7 days) |
| `/verify_premium <ref>` | Verify Premium plan payment (NGN 22,000, 14 days + copier) |
| `/status` | Check current subscription status and expiry date |
| `/help` | Show help message |

## API Endpoints

### Telegram Webhook
- **URL:** `/api/telegram/webhook`
- **Method:** `POST`
- **Description:** Receives all Telegram bot updates

### Paystack Webhook (Optional)
- **URL:** `/api/paystack/webhook`
- **Method:** `POST`
- **Description:** Receives Paystack payment events (backup flow)

### Cron Job
- **URL:** `/api/cron/remove-expired`
- **Method:** `GET`
- **Schedule:** Every hour (`0 * * * *`)
- **Auth:** Bearer token (`CRON_SECRET`)

## Configuration

### Changing Plan Details

Edit `src/lib/config.ts`:

```typescript
export const PLANS = {
  basic: {
    name: 'Basic VIP',
    amountKobo: 500000,  // NGN 5,000
    durationDays: 7,
    hasCopierAccess: false
  },
  premium: {
    name: 'Premium VIP + Copier',
    amountKobo: 2200000,  // NGN 22,000
    durationDays: 14,
    hasCopierAccess: true
  }
}
```

### Changing Bank Details

Edit `src/lib/config.ts`:

```typescript
export const BANK_DETAILS = {
  bankName: 'YOUR BANK NAME',
  accountNumber: '0000000000',
  accountName: 'Account Name'
}
```

## Edge Cases Handled

1. ✅ **Double redemption** - Reference uniqueness check prevents reuse
2. ✅ **Wrong command for amount** - Detects if user pays 22k but uses /verify_basic
3. ✅ **Invalid references** - Format validation before API calls
4. ✅ **Amount mismatch** - Verifies payment matches plan amount
5. ✅ **Payment failed/pending** - Checks transaction status
6. ✅ **Rate limiting** - Blocks users after 5 failed attempts for 1 hour
7. ✅ **Returning users** - Auto-unbans previously removed users
8. ✅ **Webhook reliability** - Always returns 200 to prevent retries
9. ✅ **API failures** - Graceful error handling with user-friendly messages
10. ✅ **Cron retries** - Failed removals are retried next hour

## Testing

### Test Mode

1. Get Paystack test keys from dashboard
2. Use Paystack test payment page to make test transactions
3. Verify with test references

### Manual Testing

```bash
# Test webhook locally (use ngrok or similar)
npm run dev

# Check database
npx prisma studio
```

## Troubleshooting

### Bot Not Responding
- Check webhook is set correctly
- Check environment variables are loaded
- Check server logs for errors

### Invite Links Not Working
- Ensure bot is admin in channel
- Check bot has "Invite users" permission
- Check user isn't banned (unban if needed)

### Cron Job Not Running
- Verify `CRON_SECRET` matches in Vercel env
- Check Vercel cron logs
- Ensure cron job returns 200 status

### Payment Verification Failing
- Verify Paystack secret key is correct
- Check transaction reference is valid
- Ensure payment status is "success"
- Check payment amount matches plan

## Security Considerations

- **Never commit `.env.local`** to git
- **Use strong `CRON_SECRET`** for production
- **Enable HTTPS** on production domain
- **Monitor webhook logs** for suspicious activity
- **Rate limiting** prevents abuse
- **Reference uniqueness** prevents double redemption

## License

MIT

## Support

For issues or questions, please open an issue on GitHub.
#   T E L E G R A M - S U B S C R P T I O N - M A N A G E R  
 