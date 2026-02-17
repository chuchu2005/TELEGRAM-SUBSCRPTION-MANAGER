import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const subscriptionId = "6994e16c247a4d3085b54756";

// Get original subscription
const original = await prisma.subscription.findUnique({
  where: { id: subscriptionId }
});

console.log("Original expiresAt:", original.expiresAt);

// Update to expired (yesterday)
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);

const updated = await prisma.subscription.update({
  where: { id: subscriptionId },
  data: { expiresAt: yesterday }
});

console.log("Updated expiresAt to:", updated.expiresAt);
console.log("✅ Subscription is now expired - ready to test cron");

await prisma.$disconnect();
