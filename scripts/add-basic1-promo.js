/**
 * Script to add "basic1" promo code to MongoDB database using Prisma
 *
 * Usage: node scripts/add-basic1-promo.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const promoCode = {
  code: "basic1",
  name: "Basic 1 Week Free",
  planType: "basic",
  durationDays: 7,
  hasCopierAccess: false,
  isFree: true,
  amountKobo: null,
  expiresAt: new Date("2099-12-31T23:59:59Z"), // Never expires
  usageLimit: null, // Unlimited total uses
  perUserLimit: 1, // Once per user
  isActive: true,
  createdBy: "admin"
};

async function addPromoCode() {
  try {
    console.log('🔗 Connecting to database via Prisma...');

    // Check if promo code already exists
    console.log('\n🔍 Checking if "basic1" already exists...');
    const existing = await prisma.promoCode.findUnique({
      where: { code: "basic1" }
    });

    if (existing) {
      console.log('⚠️  Promo code "basic1" already exists!');
      console.log('\nExisting code details:');
      console.log('   Code:', existing.code);
      console.log('   Name:', existing.name);
      console.log('   Plan:', existing.planType);
      console.log('   Duration:', existing.durationDays, 'days');
      console.log('   Used:', existing.usageCount, 'times');
      console.log('   Active:', existing.isActive);
      console.log('\n💡 If you want to update it, delete it first and run this script again.');
      return;
    }

    // Add the promo code
    console.log('\n➕ Adding "basic1" promo code to database...');
    const result = await prisma.promoCode.create({
      data: promoCode
    });

    console.log('\n✅ SUCCESS! Promo code added!');
    console.log('📋 Details:');
    console.log('   ID:', result.id);
    console.log('   Code:', result.code);
    console.log('   Name:', result.name);
    console.log('   Plan:', result.planType);
    console.log('   Duration:', result.durationDays, 'days');
    console.log('   Free:', result.isFree ? 'YES' : 'NO');
    console.log('   Expires:', result.expiresAt.toISOString());
    console.log('   Per User Limit:', result.perUserLimit);
    console.log('   Active:', result.isActive);
    console.log('\n🎉 Users can now redeem with: /promo basic1');

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

addPromoCode();
