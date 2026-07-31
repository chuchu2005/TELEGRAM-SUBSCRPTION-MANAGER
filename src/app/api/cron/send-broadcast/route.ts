import { after, NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendMessageWithKeyboard, sendMessage } from '@/lib/telegram'
import { BROADCAST_MESSAGES, ADMIN_ID } from '@/lib/config'
import { runBounded } from '@/lib/broadcast'

/**
 * Broadcast cron — Cloudflare-Workers safe.
 *
 * Workers terminate all work the moment the HTTP response is sent and cap
 * CPU time + subrequests per request. The previous version looped over every
 * user with a 100ms sleep per message, which blows past those limits and can
 * silently fail. This version:
 *   1. Responds 200 immediately so the external cron caller never times out.
 *   2. Sends via `after()` → ctx.waitUntil (work registered with the runtime,
 *      survives the response). A bare fire-and-forget loop would be killed.
 *   3. Uses bounded concurrency (runBounded, no sleeps) for speed.
 *   4. Processes in chunks, chaining the next chunk as a FRESH request so each
 *      chunk is its own Worker invocation with its own limits.
 */

const CONCURRENCY = Number(process.env.BROADCAST_CONCURRENCY) || 8
const MAX_PER_INVOCATION = Number(process.env.BROADCAST_MAX_PER_INVOCATION) || 800

type Hour = '8' | '10' | '20'
interface TradeStats {
  message: string
  trades: number
  pips: number
}
interface ChunkArgs {
  hour: Hour
  messageText: string
  buttonText: string
  offset: number
  timeLabel: string
  startedAt: Date
  tradeStats: TradeStats | null
}

/**
 * Generate randomized trade summary message.
 * Replaces {trades} and {pips} placeholders with random values.
 */
function generateTradeSummary(
  template: string,
  minTrades: number,
  maxTrades: number,
  minPips: number,
  maxPips: number
): TradeStats {
  const trades = Math.floor(Math.random() * (maxTrades - minTrades + 1)) + minTrades
  const pips = Math.floor(Math.random() * (maxPips - minPips + 1)) + minPips
  const message = template.replace('{trades}', trades.toString()).replace('{pips}', pips.toString())
  return { message, trades, pips }
}

/**
 * GET handler for broadcast cron job.
 * Sends broadcast messages to all users based on time (8am, 10am, or 8pm Nigerian).
 * Query parameter: ?hour=8, ?hour=10, or ?hour=20  (and ?offset= for internal pagination).
 */
export async function GET(request: NextRequest) {
  try {
    const now = new Date()
    const searchParams = request.nextUrl.searchParams
    const hourParam = searchParams.get('hour') || '8'
    const offset = Math.max(0, Number(searchParams.get('offset')) || 0)

    // Validate hour parameter
    const validHours: readonly Hour[] = ['8', '10', '20']
    if (!validHours.includes(hourParam as Hour)) {
      return NextResponse.json(
        { error: 'Invalid hour parameter', message: 'Hour must be 8, 10, or 20' },
        { status: 400 }
      )
    }
    const hour = hourParam as Hour
    const message = BROADCAST_MESSAGES[hour]

    // Generate dynamic message for 8pm broadcast (hour='20')
    let messageText = ''
    let tradeStats: TradeStats | null = null
    if (hour === '20' && 'template' in message) {
      const ranges = message.tradeRanges
      tradeStats = generateTradeSummary(
        message.template,
        ranges.minTrades,
        ranges.maxTrades,
        ranges.minPips,
        ranges.maxPips
      )
      messageText = tradeStats.message
      console.log(`[Broadcast Cron] Generated trade summary: ${tradeStats.trades} trade(s), ${tradeStats.pips} pips`)
    } else if ('text' in message) {
      messageText = message.text
    } else {
      messageText = message.template || ''
    }

    const timeLabel = hour === '20' ? '8 PM' : `${hour} AM`
    const buttonText = message.buttonText
    console.log(`[Broadcast Cron] Scheduling ${timeLabel} broadcast at ${now.toISOString()} (offset=${offset})`)

    // Respond immediately; send in the background via after() (ctx.waitUntil).
    after(() =>
      runBroadcastChunk({ hour, messageText, buttonText, offset, timeLabel, startedAt: now, tradeStats })
    )

    return NextResponse.json({
      success: true,
      hour,
      offset,
      status: 'scheduled',
      timestamp: now.toISOString()
    })
  } catch (error) {
    console.error('[Broadcast Cron] Error in cron job:', error)
    return NextResponse.json(
      {
        error: 'Cron job failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

/**
 * Process a single chunk of the broadcast (run inside after() / waitUntil).
 * If more recipients remain, chains the next chunk as a fresh request.
 */
async function runBroadcastChunk(args: ChunkArgs): Promise<void> {
  const { hour, messageText, buttonText, offset, timeLabel, startedAt, tradeStats } = args
  const adminId = ADMIN_ID.toString()

  // take MAX + 1 to detect whether more recipients remain after this chunk
  const users = await prisma.user.findMany({
    select: { telegramUserId: true },
    orderBy: { createdAt: 'asc' },
    skip: offset,
    take: MAX_PER_INVOCATION + 1
  })
  const hasMore = users.length > MAX_PER_INVOCATION
  const batch = users.slice(0, MAX_PER_INVOCATION)

  console.log(`[Broadcast Cron] ${timeLabel} chunk offset=${offset} → ${batch.length} users (more=${hasMore})`)

  let sentCount = 0
  let failedCount = 0
  let skippedCount = 0

  await runBounded(
    batch,
    async (user) => {
      const userId = user.telegramUserId

      // Skip admin
      if (userId === adminId) {
        skippedCount++
        return
      }

      try {
        const ok = await sendMessageWithKeyboard(userId, messageText, {
          inline_keyboard: [[{ text: buttonText, callback_data: 'broadcast_pay' }]]
        })

        if (ok) {
          sentCount++
          // Log broadcast (best-effort — never fail the batch on a log error)
          await prisma.broadcastLog
            .create({
              data: {
                messageHash: createHash('md5')
                  .update(`${hour}_${userId}_${startedAt.getTime()}`)
                  .digest('hex'),
                telegramUserId: userId,
                message: messageText,
                messageHour: hour,
                action: 'broadcast_sent'
              }
            })
            .catch((e) => console.error(`[Broadcast Cron] log create failed for ${userId}:`, e))
        } else {
          failedCount++
        }
      } catch (error) {
        failedCount++
        console.error(`[Broadcast Cron] Error sending to ${userId}:`, error)
      }
    },
    CONCURRENCY
  )

  console.log(
    `[Broadcast Cron] chunk done offset=${offset} sent=${sentCount} failed=${failedCount} skipped=${skippedCount}`
  )

  if (hasMore) {
    // Chain the next chunk as a FRESH request so each chunk is a separate
    // Worker invocation with its own CPU/subrequest budget.
    const base = process.env.NEXT_PUBLIC_APP_URL || ''
    const nextUrl = `${base}/api/cron/send-broadcast?hour=${hour}&offset=${offset + MAX_PER_INVOCATION}`
    after(() =>
      fetch(nextUrl, { method: 'GET' }).catch((e) =>
        console.error('[Broadcast Cron] pagination fetch failed:', e)
      )
    )
    return
  }

  // Final chunk → send summary to admin
  try {
    const summaryMessage = `📊 <b>Broadcast Summary - ${timeLabel} Nigerian Time</b>

━━━━━━━━━━━━━━━━━━━

✅ <b>Successfully Sent (this run):</b> ${sentCount}
❌ <b>Failed:</b> ${failedCount}
⏭️ <b>Skipped:</b> ${skippedCount}

${tradeStats ? `━━━━━━━━━━━━━━━━━━━\n\n📈 <b>Trade Stats Used:</b>\n• Trades: ${tradeStats.trades}\n• Pips: ${tradeStats.pips}\n\n` : ''}━━━━━━━━━━━━━━━━━━━

<b>Timestamp:</b> ${startedAt.toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}

<i>${failedCount > 0 ? '⚠️ Some messages failed. Check logs for details.' : '✨ Broadcast run complete!'}</i>`

    await sendMessage(adminId, summaryMessage)
    console.log('[Broadcast Cron] Final summary sent to admin')
  } catch (error) {
    console.error('[Broadcast Cron] Failed to send summary to admin:', error)
  }
}

// Allow POST for testing
export async function POST(request: NextRequest) {
  return GET(request)
}
