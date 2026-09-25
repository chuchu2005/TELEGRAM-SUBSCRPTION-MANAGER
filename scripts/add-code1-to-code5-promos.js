/**
 * Script to add "code1" through "code5" promo codes to the database using Prisma
 *
 * Grants: Basic VIP plan, 7 days, free, no copier access.
 * Limits: once per user (perUserLimit=1), unlimited total users (usageLimit=null).
 *
 * Usage: node scripts/add-code1-to-code5-promos.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const codes = ["code1", "code2", "code3", "code4", "code5"];

const promoData = {
  name: "1 Week Free — No Copier",
  planType: "basic",        // Basic VIP; PLANS.basic.durationDays = 7 (drives granted duration)
  durationDays: 7,
  hasCopierAccess: false,
  isFree: true,
  amountKobo: null,
  expiresAt: new Date("2099-12-31T23:59:59Z"), // Never expires
  usageLimit: null,         // Unlimited total users
  perUserLimit: 1,          // Once per user
  isActive: true,
  createdBy: "admin"
};

async function addPromoCodes() {
  try {
    console.log('🔗 Connecting to database via Prisma...');

    for (const code of codes) {
      console.log(`\n🔍 Checking if "${code}" already exists...`);
      const existing = await prisma.promoCode.findUnique({ where: { code } });

      if (existing) {
        console.log(`⚠️  Promo code "${code}" already exists — skipping.`);
        continue;
      }

      console.log(`➕ Adding "${code}" promo code to database...`);
      const result = await prisma.promoCode.create({
        data: { code, ...promoData }
      });

      console.log(`✅ Added: ${result.code} (ID: ${result.id})`);
      console.log(`   Name: ${result.name}`);
      console.log(`   Plan: ${result.planType} | Duration: ${result.durationDays} days | Free: ${result.isFree ? 'YES' : 'NO'} | Copier: ${result.hasCopierAccess ? 'YES' : 'NO'}`);
    }

    console.log('\n🎉 Done! Users can redeem with: /promo code1 ... /promo code5');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code === 'P2002') {
      console.error('⚠️  A promo code with this code already exists (unique constraint)');
    }
  } finally {
    await prisma.$disconnect();
    console.log('\n🔌 Connection closed');
  }
}

addPromoCodes();
