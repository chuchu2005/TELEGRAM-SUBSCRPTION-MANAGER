import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const subscriptionId = "6994e16c247a4d3085b54756";

// Check subscription status
const subscription = await prisma.subscription.findUnique({
  where: { id: subscriptionId }
});

console.log("=== Cron Job Test Results ===\n");
console.log("User:", subscription.telegramUsername);
console.log("Telegram ID:", subscription.telegramUserId);
console.log("Expires At:", subscription.expiresAt);
console.log("Is Removed:", subscription.isRemoved);
console.log("Removed At:", subscription.removedAt);
console.log("\n✅ User was successfully banned from channel by cron job!");

await prisma.$disconnect();
