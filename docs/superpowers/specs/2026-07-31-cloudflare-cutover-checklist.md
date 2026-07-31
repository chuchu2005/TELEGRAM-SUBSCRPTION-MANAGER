# Cloudflare Cutover Checklist — vipbot

**Date:** 2026-07-31
**Status:** Code changes complete + build-verified. Remaining steps are mostly **your** dashboard actions.

All code changes are done locally and the OpenNext build passes (`npm run build:cf` → `.open-next/worker.js`). Nothing is committed, so Vercel is still your live app. **Do not `git push` until Step 1 (Accelerate) and Step 2 (env vars on BOTH platforms) are complete** — otherwise the next Vercel auto-deploy will break (it would expect the Accelerate URL).

---

## What changed (summary)

| Area | Change |
|---|---|
| Next.js | 16.1.6 → **16.2.12** (OpenNext requires ≥16.2.11) |
| OpenNext | Added `open-next.config.ts` + committed `wrangler.jsonc` (name `telegram-subscrption-manager`, `nodejs_compat`, self-ref/ASSETS/IMAGES bindings). Fixes the original `vipbot` deploy error. |
| Build | Added `npm run build:cf` = `prisma generate && opennextjs-cloudflare build` |
| DB | Prisma **Accelerate**: `prisma/schema.prisma` `directUrl`, `src/lib/prisma.ts` `withAccelerate()` |
| Broadcast | All 3 paths now Cloudflare-safe via shared `runBounded` (bounded concurrency, no sleeps) + `after()` + chunked self-pagination for the cron route. |

Files changed: `package.json`, `next.config.ts` (unchanged), `open-next.config.ts` (new), `wrangler.jsonc` (new), `prisma/schema.prisma`, `src/lib/prisma.ts`, `src/lib/broadcast.ts`, `src/app/api/cron/send-broadcast/route.ts`, `src/app/api/admin/broadcast/route.ts`, `src/app/api/telegram/webhook/route.ts`.

---

## Step 1 — Set up Prisma Accelerate  👤 (you, browser)

1. Go to the **Prisma Data Platform** → https://console.prisma.io
2. Create a project and **enable Accelerate**, connecting it to your MongoDB Atlas cluster (use the existing `mongodb+srv://` string).
3. Copy the **Accelerate connection URL** — it looks like `prisma://accelerate.prisma-data-platform.net/<key>`. This is your new runtime `DATABASE_URL`.
4. Register/sync the schema with Accelerate by running locally with the direct URL set:
   ```
   DIRECT_DATABASE_URL='mongodb+srv://...your current Atlas string...' npx prisma db push
   ```
   (Docs: https://www.prisma.io/docs/accelerate/getting-started)

> Note: Accelerate is a hosted gateway (free tier available, then paid). It adds a little latency per query.

## Step 2 — Set environment variables on BOTH platforms  👤 (you)

Because both Vercel and Cloudflare deploy from this repo, **both** need the new DB URLs once the code is pushed.

**Add/Update (Secrets):**
- `DATABASE_URL` = the **Accelerate** URL (`prisma://...`)  ← changed from the old direct string
- `DIRECT_DATABASE_URL` = your current `mongodb+srv://...` Atlas string  ← **new**
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `PAYSTACK_SECRET_KEY`, `ENCRYPTION_KEY`, `METACOPIER_API_KEY`, `METACOPIER_API_KEY_2`, `METACOPIER_MASTER_ACCOUNT_ID`, `METACOPIER_MASTER_ACCOUNT_ID_2`, `ADMIN_ID`, `ADMIN_SECRET` (currently missing from `.env`)

**Plain vars:**
- `METACOPIER_API_BASE_URL`, `METACOPIER_REGION`
- `NEXT_PUBLIC_APP_URL` = the public app URL — **build-time**, so it must exist in the **build** environment, not just runtime.
  - On **Vercel**: keep `https://telegram-subscrption-manager.vercel.app` until cutover (Step 5).
  - On **Cloudflare**: set to your Cloudflare domain (e.g. `https://telegram-subscrption-manager.pages.dev` or your custom domain) **before** the build.

## Step 3 — Cloudflare build settings  👤 (you, Cloudflare dashboard)

For the `telegram-subscrption-manager` Pages/Workers project → Settings → Build:
- **Build command:** `npm run build:cf`
- **Deploy command:** `npx wrangler deploy`
- **Root directory:** `/`
- Add `NEXT_PUBLIC_APP_URL` and the secrets to the build/ runtime environment.

## Step 4 — Push & verify (no live traffic yet)  👤 (you)

1. `git add` the changed files, commit, push to `main`.
2. Both Vercel and Cloudflare rebuild. Vercel now also uses Accelerate (verify it still works — send a test message via the bot).
3. Cloudflare deploys the worker. Smoke-test the Cloudflare URL directly (webhooks still point at Vercel, so **no live traffic** on Cloudflare yet):
   - `curl https://<CF_URL>/api/telegram/webhook` → should return `{"status":"Telegram webhook is running"}`
   - `curl https://<CF_URL>/api/admin/broadcast` → JSON info with live DB stats (confirms Accelerate works end-to-end).
4. Send yourself a test bot command that hits the DB (e.g. `/status`) **on the Cloudflare URL** to confirm Prisma+Accelerate works. (You can temporarily set the Telegram webhook to CF, test, then set it back — see Step 5.)

## Step 5 — Cutover (the only live-affecting step)  👤 (you)

Once Cloudflare is verified, flip traffic to it:

1. **Telegram webhook** → Cloudflare:
   ```
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<CF_URL>/api/telegram/webhook"
   ```
2. **Paystack webhook** → Cloudflare URL (Paystack dashboard → Settings → Webhooks).
3. **`NEXT_PUBLIC_APP_URL`** on Cloudflare → your CF domain (rebuild), and on Vercel → CF domain too (so payment links/redirects point at CF).
4. **External cron site** → repoint all 4 endpoints to the CF URL. `send-broadcast` needs **3 separate jobs**: `?hour=8`, `?hour=10`, `?hour=20`. (GitHub Actions for reminders/expired are redundant per your setup — disable or leave; just don't rely on them.)
5. Watch logs for one full broadcast cycle to confirm the chunked fan-out works.

## Rollback plan

- Vercel stays live throughout. To roll back instantly: repoint the Telegram + Paystack webhooks back to the Vercel URL.
- Cloudflare also supports one-click rollback to a previous deployment (Workers & Pages → Deployments).

## Open items / risks

- **Accelerate cost/latency** — confirm the plan fits.
- **`ADMIN_SECRET`** is referenced by `scripts/broadcast.mjs` but missing from `.env` — add it (and to Cloudflare/Vercel).
- **Cron endpoints remain unauthenticated** (per your decision to leave cron as-is). Anyone with the URL can trigger them.
- **Broadcast self-pagination** relies on `NEXT_PUBLIC_APP_URL` being the CF URL so the worker can fetch its own next chunk.
- Committing/pushing before Steps 1–2 breaks Vercel. Order matters.
