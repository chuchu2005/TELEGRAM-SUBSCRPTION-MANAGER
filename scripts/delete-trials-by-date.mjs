#!/usr/bin/env node

/**
 * Script to delete trial subscriptions for a specific date
 *
 * Usage:
 *   node scripts/delete-trials-by-date.mjs              # Delete trials from today
 *   node scripts/delete-trials-by-date.mjs --dry-run    # Preview without deleting
 *   node scripts/delete-trials-by-date.mjs --date=2026-05-20  # Specific date
 *
 * Date format: YYYY-MM-DD
 */

import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

// Parse command line arguments
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const dateArg = args.find(arg => arg.startsWith('--date='))

// Default to today or specified date
let targetDate
if (dateArg) {
  const dateStr = dateArg.split('=')[1]
  targetDate = new Date(dateStr + 'T00:00:00.000Z')
} else {
  targetDate = new Date()
  targetDate.setHours(0, 0, 0, 0) // Start of today
}

// Calculate end of target date
const endDate = new Date(targetDate)
endDate.setDate(endDate.getDate() + 1) // Next day

console.log('='.repeat(60))
console.log('Trial Subscription Deletion Script')
console.log('='.repeat(60))
console.log(`Target Date: ${targetDate.toISOString().split('T')[0]}`)
console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE DELETION'}`)
console.log('='.repeat(60))

try {
  // Find all trial subscriptions created on the target date
  // Note: createdAt is mapped to _id in MongoDB ObjectId which contains timestamp
  const trials = await prisma.subscription.findMany({
    where: {
      planType: 'trial',
      createdAt: {
        gte: targetDate,
        lt: endDate
      }
    }
  })

  if (trials.length === 0) {
    console.log(`✓ No trial subscriptions found for ${targetDate.toISOString().split('T')[0]}`)
    process.exit(0)
  }

  console.log(`\nFound ${trials.length} trial subscription(s) created on ${targetDate.toISOString().split('T')[0]}`)

  // Display each trial
  trials.forEach((trial, index) => {
    console.log(`\n${index + 1}. User ID: ${trial.telegramUserId}`)
    console.log(`   Username: ${trial.telegramUsername || 'N/A'}`)
    console.log(`   Name: ${trial.telegramName}`)
    console.log(`   Reference: ${trial.paystackRef}`)
    console.log(`   Created: ${trial.createdAt?.toISOString()}`)
    console.log(`   Expires: ${trial.expiresAt?.toISOString()}`)
    console.log(`   Invite Link: ${trial.inviteLinkUsed || 'N/A'}`)
  })

  if (dryRun) {
    console.log('\n' + '='.repeat(60))
    console.log('DRY RUN COMPLETE - No deletions performed')
    console.log('Run without --dry-run to actually delete these records')
    console.log('='.repeat(60))
    process.exit(0)
  }

  // Confirm before deletion
  console.log('\n' + '='.repeat(60))
  console.log(`WARNING: About to DELETE ${trials.length} trial subscription(s)`)
  console.log('This action CANNOT be undone!')
  console.log('='.repeat(60))

  // In non-interactive mode, we proceed automatically
  // For safety, you could add a confirmation prompt here

  console.log('\nProceeding with deletion...')

  // Delete each trial
  let deletedCount = 0
  for (const trial of trials) {
    try {
      await prisma.subscription.delete({
        where: { id: trial.id }
      })
      deletedCount++
      console.log(`✓ Deleted trial for user ${trial.telegramUserId}`)
    } catch (error) {
      console.error(`✗ Failed to delete trial for user ${trial.telegramUserId}:`, error.message)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('Deletion Complete')
  console.log(`Total trials found: ${trials.length}`)
  console.log(`Successfully deleted: ${deletedCount}`)
  console.log(`Failed: ${trials.length - deletedCount}`)
  console.log('='.repeat(60))

} catch (error) {
  console.error('\n❌ Error:', error.message)
  console.error(error)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}