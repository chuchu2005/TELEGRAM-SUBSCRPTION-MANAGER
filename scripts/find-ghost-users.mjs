/**
 * Script to find users who are still in the channel but have expired subscriptions
 * This identifies data integrity issues where the bot failed to remove users
 */

import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

// Telegram Bot Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

if (!TELEGRAM_BOT_TOKEN || !CHANNEL_ID) {
  console.error('❌ Missing required environment variables: TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID');
  process.exit(1);
}

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

/**
 * Check if a user is a member of the channel
 */
async function isUserInChannel(userId) {
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/getChatMember?chat_id=${CHANNEL_ID}&user_id=${userId}`);
    const data = await response.json();

    if (!data.ok) {
      return false;
    }

    // User is in channel if status is member, administrator, or creator
    return ['member', 'administrator', 'creator'].includes(data.result?.status || '');
  } catch (error) {
    console.error(`Error checking user ${userId}:`, error);
    return false;
  }
}

/**
 * Main function to find users who should have been removed
 */
async function findGhostUsers() {
  console.log('🔍 Finding users who should have been removed...\n');

  const now = new Date();

  // Find all expired subscriptions (including those marked as removed)
  const allExpiredSubscriptions = await prisma.subscription.findMany({
    where: {
      expiresAt: { lt: now }
    },
    include: {
      mt5Setup: true
    },
    orderBy: {
      expiresAt: 'desc'
    }
  });

  console.log(`📊 Total expired subscriptions in database: ${allExpiredSubscriptions.length}\n`);

  const ghostUsers = [];
  const checkedUsers = new Set();
  let checkedCount = 0;
  let apiCallCount = 0;

  for (const subscription of allExpiredSubscriptions) {
    const userId = subscription.telegramUserId;

    // Skip if we've already checked this user (they might have multiple expired subs)
    if (checkedUsers.has(userId)) {
      continue;
    }

    checkedUsers.add(userId);
    checkedCount++;

    // Check if user is still in channel
    const inChannel = await isUserInChannel(userId);
    apiCallCount++;

    if (inChannel) {
      // User is still in channel but subscription is expired - THIS IS THE ISSUE
      ghostUsers.push({
        telegramUserId: userId,
        username: subscription.telegramUsername || 'N/A',
        telegramName: subscription.telegramName || 'N/A',
        email: subscription.customerEmail || 'N/A',
        planType: subscription.planType,
        expiresAt: subscription.expiresAt,
        isRemoved: subscription.isRemoved,
        removedAt: subscription.removedAt,
        daysExpired: Math.floor((now - subscription.expiresAt) / (1000 * 60 * 60 * 24)),
        amountKobo: subscription.amountKobo,
        amountNaira: subscription.amountKobo / 100
      });
    }

    // Add delay to avoid rate limiting (Telegram has ~30 calls per second limit)
    await new Promise(resolve => setTimeout(resolve, 50));

    // Progress indicator
    if (checkedCount % 10 === 0) {
      console.log(`⏳ Checked ${checkedCount} users...`);
    }
  }

  console.log(`\n✅ Checked ${checkedCount} unique users (${apiCallCount} API calls)\n`);

  // Display results
  if (ghostUsers.length === 0) {
    console.log('✨ No ghost users found! All expired users have been removed.');
  } else {
    console.log(`👻 Found ${ghostUsers.length} users still in channel with expired subscriptions:\n`);

    // Sort by days expired (most expired first)
    ghostUsers.sort((a, b) => b.daysExpired - a.daysExpired);

    console.log('═════════════════════════════════════════════════════════════════\n');

    for (const user of ghostUsers) {
      console.log(`👤 User ID: ${user.telegramUserId}`);
      console.log(`   Name: ${user.telegramName}`);
      console.log(`   Username: @${user.username}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Plan: ${user.planType}`);
      console.log(`   Amount paid: ₦${user.amountNaira.toLocaleString()}`);
      console.log(`   Expired: ${user.expiresAt.toISOString()}`);
      console.log(`   Days expired: ${user.daysExpired} days ago`);
      console.log(`   Marked as removed: ${user.isRemoved ? '✅' : '❌'}`);
      if (user.isRemoved) {
        console.log(`   Removed at: ${user.removedAt?.toISOString() || 'N/A'}`);
      }
      console.log('───────────────────────────────────────────────────────────────\n');
    }

    // Summary statistics
    console.log('📈 Summary Statistics:');
    console.log(`   Total ghost users: ${ghostUsers.length}`);
    console.log(`   Most expired: ${Math.max(...ghostUsers.map(u => u.daysExpired))} days`);
    console.log(`   Least expired: ${Math.min(...ghostUsers.map(u => u.daysExpired))} days`);

    const byPlan = ghostUsers.reduce((acc, user) => {
      acc[user.planType] = (acc[user.planType] || 0) + 1;
      return acc;
    }, {});
    console.log(`   By plan:`, byPlan);

    const markedRemoved = ghostUsers.filter(u => u.isRemoved).length;
    console.log(`   Marked as removed in DB: ${markedRemoved}`);
    console.log(`   NOT marked as removed in DB: ${ghostUsers.length - markedRemoved}`);
  }

  return ghostUsers;
}

// Run the script
try {
  const ghostUsers = await findGhostUsers();
  await prisma.$disconnect();

  // Exit with code 1 if ghost users found (useful for CI/CD)
  process.exit(ghostUsers.length > 0 ? 1 : 0);
} catch (error) {
  console.error('❌ Error running script:', error);
  await prisma.$disconnect();
  process.exit(1);
}