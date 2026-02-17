import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const subscriptionId = "6994e16c247a4d3085b54756";

// Restore subscription
const restored = await prisma.subscription.update({
  where: { id: subscriptionId },
  data: {
    isRemoved: false,
    removedAt: null,
    expiresAt: new Date("2026-02-24T21:45:16.827Z") // Original expiry date
  }
});

console.log("✅ Subscription restored!");
console.log("User:", restored.telegramUsername);
console.log("Expires At:", restored.expiresAt);
console.log("Is Removed:", restored.isRemoved);
console.log("\n⚠️ User needs to be unbanned and re-invited to the channel!");

await prisma.$disconnect();
