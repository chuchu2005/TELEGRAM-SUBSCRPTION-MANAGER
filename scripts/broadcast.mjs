#!/usr/bin/env node

/**
 * Broadcast message script
 * Usage: node scripts/broadcast.mjs "Your message here"
 * Options:
 *   --plan=basic|monthly|premium|all  (default: all)
 *   --active-only                     (only send to active subscribers)
 */

import 'dotenv/config'

const ADMIN_SECRET = process.env.ADMIN_SECRET
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

// Parse command line arguments
const args = process.argv.slice(2)
let message = ''
let planType = 'all'
let activeOnly = false

for (const arg of args) {
  if (arg.startsWith('--plan=')) {
    planType = arg.split('=')[1]
    if (!['basic', 'monthly', 'premium', 'all'].includes(planType)) {
      console.error('❌ Invalid plan type. Use: basic, monthly, premium, or all')
      process.exit(1)
    }
  } else if (arg === '--active-only') {
    activeOnly = true
  } else if (arg.startsWith('--')) {
    console.error(`❌ Unknown option: ${arg}`)
    process.exit(1)
  } else {
    message += (message ? ' ' : '') + arg
  }
}

if (!message) {
  console.error('❌ No message provided!')
  console.error('\nUsage: node scripts/broadcast.mjs "Your message" [options]')
  console.error('\nOptions:')
  console.error('  --plan=basic|monthly|premium|all  Filter by plan type')
  console.error('  --active-only                     Only send to active subscribers')
  console.error('\nExample:')
  console.error('  node scripts/broadcast.mjs "🎉 Special offer this week!" --plan=monthly --active-only')
  process.exit(1)
}

console.log('📢 Sending broadcast...')
console.log('Message:', message)
console.log('Plan Type:', planType)
console.log('Active Only:', activeOnly)
console.log('')

try {
  const response = await fetch(`${BASE_URL}/api/admin/broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_SECRET}`
    },
    body: JSON.stringify({
      message,
      planType,
      activeOnly
    })
  })

  const result = await response.json()

  if (!response.ok) {
    console.error('❌ Broadcast failed:', result.error || result.message)
    process.exit(1)
  }

  console.log('✅ Broadcast sent successfully!')
  console.log('\n📊 Stats:')
  console.log(`   Total recipients: ${result.stats.total}`)
  console.log(`   ✅ Successful: ${result.stats.successful}`)
  console.log(`   ❌ Failed: ${result.stats.failed}`)

  if (result.stats.failedUsers.length > 0) {
    console.log('\n❌ Failed users:')
    result.stats.failedUsers.forEach(user => console.log(`   - ${user}`))
  }
} catch (error) {
  console.error('❌ Error:', error.message)
  process.exit(1)
}
