# Broadcasting Messages to Users

This guide shows you how to send marketing messages and announcements to your bot users.

## 🚀 Quick Start

### Method 1: Using the Script (Easiest)

1. Make sure your server is running (either locally or deployed)
2. Run the broadcast script:

```bash
# Send to all users
node scripts/broadcast.mjs "🎉 Special offer! Get 20% off this week!"

# Send only to monthly plan users
node scripts/broadcast.mjs "📅 Monthly members exclusive deal!" --plan=monthly

# Send only to active premium subscribers
node scripts/broadcast.mjs "👑 Premium-only announcement!" --plan=premium --active-only
```

### Method 2: Using curl

```bash
# Send to all users
curl -X POST http://localhost:3000/api/admin/broadcast \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"message": "Your message here"}'

# Send to specific plan
curl -X POST http://localhost:3000/api/admin/broadcast \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"message": "Monthly plan exclusive!", "planType": "monthly", "activeOnly": true}'
```

### Method 3: Check Subscriber Stats First

```bash
curl http://localhost:3000/api/admin/broadcast \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

## 📝 Message Formatting

You can use **HTML formatting** in your messages:

```
<b>Bold text</b>
<i>Italic text</i>
<code>Code</code>
<a href="https://example.com">Link</a>
< pre>Preformatted text</pre>
```

### Example Messages

**Simple promotion:**
```
🎉 <b>Flash Sale!</b>

Get 20% off all plans this weekend!

Use code: WEEKEND20

Valid until Sunday midnight.
```

**Plan upgrade announcement:**
```
👑 <b>Upgrade to Premium!</b>

━━━━━━━━━━━━━━━━━━━

Get access to our exclusive Auto Copier Bot!

💎 Perfect for:
• Busy traders
• Passive income seekers
• Automated trading

📈 85% of our premium members see results within 2 weeks!

Upgrade now: /pay
```

**New feature announcement:**
```
🆕 <b>New Feature Alert!</b>

We're excited to announce daily market analysis!

📊 What you'll get:
• Pre-market analysis
• Trade setups
• Risk management tips
• And much more!

Already included in your subscription.
```

## 🎯 Targeting Options

| Option | Values | Description |
|--------|--------|-------------|
| `planType` | `basic`, `monthly`, `premium`, `all` | Send to specific plan or everyone |
| `activeOnly` | `true`, `false` | Only send to users with active subscriptions |

## 📊 Examples by Use Case

### Send to Everyone
```bash
node scripts/broadcast.mjs "🎉 Big announcement!"
```

### Active Members Only (Best for Engagement)
```bash
node scripts/broadcast.mjs "🔥 Hot trading opportunity!" --active-only
```

### Premium Upsell
```bash
node scripts/broadcast.mjs "👑 Upgrade to Premium for Auto Copier access!" --plan=basic --active-only
```

### Expiry Reminders
```bash
node scripts/broadcast.mjs "⏰ Your subscription expires soon! Renew now to keep access." --active-only
```

## 🛡️ Security

**IMPORTANT:** The broadcast endpoint is protected by `ADMIN_SECRET`. Never share this key or expose it in frontend code.

**For production deployment:**
1. Set `ADMIN_SECRET` in your Vercel environment variables
2. Use your production URL: `https://telegram-subscrption-manager.vercel.app`
3. Keep your admin secret secure!

## ⚠️ Rate Limiting

Telegram has rate limits:
- **20 messages per second** to different users
- **1 message per second** to the same user

The broadcast script automatically adds a 100ms delay between messages to stay within limits.

## 🔧 Troubleshooting

**"Unauthorized" error:**
- Check that ADMIN_SECRET is set correctly in .env
- Verify you're using Bearer token in Authorization header

**"Forbidden" error:**
- ADMIN_SECRET doesn't match
- Check environment variable is set in production

**Some users failed:**
- Users may have blocked the bot
- Users may have deleted their chats
- This is normal, expected for 5-10% of users

## 💡 Best Practices

1. **Keep messages short** - Under 200 characters for best engagement
2. **Use emojis** - Makes messages more engaging
3. **Include call-to-action** - Tell users what to do next
4. **Time it right** - Send during trading hours for best results
5. **Don't spam** - Limit to 1-2 messages per day max
6. **Test first** - Send to yourself before broadcasting to everyone

## 📈 Getting Stats

Check your subscriber stats anytime:

```bash
curl https://telegram-subscrption-manager.vercel.app/api/admin/broadcast \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

This returns:
- Total unique users
- Subscribers by plan type
- Active subscribers by plan type
