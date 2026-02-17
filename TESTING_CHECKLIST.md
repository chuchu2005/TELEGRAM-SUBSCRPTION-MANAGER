# Testing Checklist - Telegram Payment Bot

Use this checklist to test the complete webhook-free flow.

## Prerequisites

- [ ] Bot is running via ngrok: `http://nonarticulative-atypical-jessi.ngrok-free.dev`
- [ ] Telegram webhook is set: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=http://nonarticulative-atypical-jessi.ngrok-free.dev/api/telegram/webhook`
- [ ] MongoDB is connected (DATABASE_URL has `/vipbot` database name)
- [ ] Paystack is in test mode (using `sk_test_...` key)

## Test Flow - New User

### Test 1: /start Command
**Expected Result:**
```
👋 Welcome to Premium VIP Community Access Bot!

Choose a plan to get instant access to our VIP community:

💎 Basic Plan - ₦5,000
├─ 7 days access
├─ VIP group only
└─ _Perfect for trying out_

👑 Premium Plan - ₦22,000
├─ 14 days access
├─ VIP group + Auto Copier Bot
└─ _Best value for serious traders_

━━━━━━━━━━━━━━━━━━━

📋 Quick Start:
1️⃣ Send /pay to get payment link
2️⃣ Complete payment securely
3️⃣ Copy your reference & send to bot
4️⃣ Receive invite link instantly!

*Need help?* Send /help

_Type /pay to get started_
```

**Check:**
- [ ] No bank account details shown
- [ ] Both plans displayed correctly
- [ ] Quick Start section present
- [ ] Sends user to /pay

---

### Test 2: /pay Command (Step 1)
**Expected Result:**
```
📧 Step 1: Enter Your Email

Please provide your email address to continue.

*Why do we need this?*
✅ To send your official payment receipt
✅ To help if there are any issues
✅ To notify you before expiration

━━━━━━━━━━━━━━━━━━━

_Just type your email (e.g., john@email.com)_

_Or send /cancel to exit_
```

**Check:**
- [ ] Email is collected
- [ ] Clear explanation of why email is needed
- [ ] /cancel option is mentioned

---

### Test 3: Invalid Email
**Action:** Type an invalid email (e.g., "john" or "john@")

**Expected Result:**
```
❌ Invalid email format

Please enter a valid email address.

*Examples:*
✅ john@email.com
✅ mary.smith@gmail.com
❌ john
❌ john@
❌ @email.com

_Type your email again or send /cancel to exit_
```

**Check:**
- [ ] Shows error with examples
- [ ] Allows retry
- [ ] /cancel still works

---

### Test 4: Valid Email (Step 2)
**Action:** Type a valid email (e.g., `test@example.com`)

**Expected Result:**
```
✅ Email Confirmed: test@example.com

━━━━━━━━━━━━━━━━━━━

💳 Step 2: Choose Your Plan

💎 Basic Plan - ₦5,000
├─ 7 days VIP access
└─ _For trying out_

👑 Premium Plan - ₦22,000
├─ 14 days VIP + Copier Bot
└─ _Best value_

━━━━━━━━━━━━━━━━━━━

*Tap a button below to pay securely:*

_Payment via bank transfer only_

_After payment → You'll see your reference_
_Then send: /verify_basic REFERENCE_

_💡 Tip: You'll find the reference on the success page after payment_

_Or send /pay to start over_

[Two buttons: 💎 Pay ₦5,000 (Basic) and 👑 Pay ₦22,000 (Premium)]

_Still have questions? Send /help_
```

**Check:**
- [ ] Email is confirmed
- [ ] Two payment buttons appear
- [ ] Step 2 is clearly labeled
- [ ] Mentions bank transfer only
- [ ] Next steps are clear

---

### Test 5: Click Payment Button
**Action:** Click "💎 Pay ₦5,000 (Basic)" button

**Expected Result:**
- Opens Paystack payment page in Telegram browser
- Only shows bank transfer option
- Has user's pre-filled email

**Check:**
- [ ] Payment page opens
- [ ] Bank transfer is the only option
- [ ] Email is pre-filled
- [ ] Amount is ₦5,000

---

### Test 6: Payment Success Page
**Action:** Complete test payment

**Expected Result:**
See payment success page with:
- ✅ "Payment Successful!" header
- 📋 "Find Your Reference" section (3 methods)
- 🔍 "What It Looks Like" section (reference format)
- 📱 "Next Steps" section (5 numbered steps)
- 💡 Example showing command format
- ❓ "Can't find your reference?" help section
- 📱 "Return to Telegram Bot" button

**Check:**
- [ ] Success page loads
- [ ] Reference finding guide is clear
- [ ] Example shows exact command format
- [ ] Return button works

---

### Test 7: /verify_basic with Valid Reference
**Action:** Copy reference from success page/email, send to bot: `/verify_basic YOUR_REFERENCE`

**Expected Result:**
```
✅ Payment Verified Successfully!

💎 Plan: Basic VIP
💰 Amount: NGN 5,000
📅 Access expires: [Date]

Here is your one-time invite link (valid for 24 hours):
👉 [INVITE LINK]

Click the link to join the channel. The link can only be used once.

Type /status anytime to check your subscription.
```

**Check:**
- [ ] Payment is verified
- [ ] Invite link is sent
- [ ] Plan details are correct
- [ ] Expiry date is shown
- [ ] Email is saved to database

---

### Test 8: /status Command (Active Subscription)
**Expected Result:**
```
✅ Your subscription is ACTIVE

💎 Plan: Basic VIP
📅 Started: [Date]
⏰ Expires: [Date] (X days remaining)

You currently have access to the channel.
```

**Check:**
- [ ] Shows correct plan
- [ ] Shows start date
- [ ] Shows expiry date and days remaining
- [ ] Confirms active access

---

### Test 9: Wrong Command for Amount
**Action:** Pay ₦22,000 but use `/verify_basic REFERENCE`

**Expected Result:**
```
❌ You used /verify_basic but paid for the Premium plan (NGN 22,000).

Please use /verify_premium REFERENCE instead.
```

**Check:**
- [ ] Detects amount mismatch
- [ ] Tells user which command to use
- [ ] Helps user correct mistake

---

### Test 10: /help Command
**Expected Result:**
```
📖 How to Get Started

━━━━━━━━━━━━━━━━━━━

*Step 1: Get Payment Link*
Send the command: /pay

*Step 2: Choose Your Plan*
💎 Basic (₦5,000) - 7 days
👑 Premium (₦22,000) - 14 days + Copier Bot

*Step 3: Make Payment*
• Pay securely with bank transfer
• Payment is instant & automatic

*Step 4: Get Your Reference*
• After payment, you'll see a receipt
• Copy the reference (e.g., TXN_1234567890)
• It looks like: REF_######## or ########

*Step 5: Verify & Get Access*
• Send: /verify_basic YOUR_REFERENCE
• Or: /verify_premium YOUR_REFERENCE
• Bot verifies instantly → sends invite link

━━━━━━━━━━━━━━━━━━━

*❓ Frequently Asked Questions*

_Q: What if I don't have a reference?_
A: Make sure you copy it from the Paystack success page after payment.

_Q: How long does the invite link last?_
A: 24 hours from when it was created.

_Q: Can I renew after it expires?_
A: Yes! Just pay again and verify the new reference.

_Q: I'm stuck. What do I do?_
A: Send /pay to start over, or /status to check your current subscription.

━━━━━━━━━━━━━━━━━━━

_Ready? Send /pay to begin!_
```

**Check:**
- [ ] All 5 steps are clear
- [ ] FAQ section answers common questions
- [ ] Commands are interconnected
- [ ] Beginner-friendly

---

### Test 11: /cancel Command
**Action:** While in email input mode, send `/cancel`

**Expected Result:**
```
✅ Cancelled. Send /pay when you're ready to get payment links.
```

**Check:**
- [ ] Exits email collection flow
- [ ] Removes user from pending list
- [ ] Can restart with /pay

---

### Test 12: Already Redeemed Reference
**Action:** Try to verify the same reference twice

**Expected Result:**
```
❌ This transaction reference has already been redeemed.

Each reference can only be used once. If you think this is an error, please contact support.
```

**Check:**
- [ ] Detects duplicate reference
- [ ] Prevents double redemption
- [ ] Clear error message

---

## Edge Cases

### Test 13: Returning User (Previously Removed)
**Scenario:** User's subscription expired, they were removed, now they're paying again

**Check:**
- [ ] User is unbanned before new invite link is created
- [ ] New invite link works
- [ ] New subscription is saved correctly

---

### Test 14: Rate Limiting
**Action:** Submit 5 invalid references

**Expected Result:**
```
Too many failed verification attempts. Please try again in 1 hour.
```

**Check:**
- [ ] Rate limit triggers after 5 failed attempts
- [ ] Blocks for 1 hour
- [ ] Resets on successful verification

---

## Database Verification

After testing, check MongoDB:

```javascript
// Check subscriptions
db.subscriptions.find({}).pretty()

// Verify email is saved
db.subscriptions.find({ customerEmail: { $exists: true } }).pretty()

// Check plan types
db.subscriptions.find({ planType: "basic" }).pretty()
db.subscriptions.find({ planType: "premium" }).pretty()
```

**Verify:**
- [ ] Email is saved to database
- [ ] planType is correct ("basic" or "premium")
- [ ] hasCopierAccess is false for basic, true for premium
- [ ] expiresAt is correct (7 days for basic, 14 days for premium)
- [ ] paystackRef is unique

---

## Common Issues & Fixes

### Issue: Webhook not receiving updates
**Fix:**
```bash
# Check webhook status
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo

# Reset webhook
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/deleteWebhook

# Set webhook again
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=http://nonarticulative-atypical-jessi.ngrok-free.dev/api/telegram/webhook"
```

### Issue: MongoDB connection error
**Fix:** Make sure DATABASE_URL includes database name:
```
mongodb+srv://.../vipbot?appName=Cluster0
```

### Issue: Invite link says "expired"
**Fix:** Check if user was previously banned. Bot should auto-unban them.

---

## Post-Testing

Once all tests pass:
1. [ ] Update `.env` with production credentials
2. [ ] Deploy to Vercel
3. [ ] Update webhook URL to production domain
4. [ ] Test in production with real payments (small amounts first)
5. [ ] Monitor logs for any issues
6. [ ] Set up Vercel cron jobs

---

## Quick Test Commands

```bash
# Check webhook info
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo

# Get bot info
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getMe

# Get webhook test response
curl http://nonarticulative-atypical-jessi.ngrok-free.dev/api/telegram/webhook
```
