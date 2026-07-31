# Cloudflare Migration Design — vipbot

**Date:** 2026-07-31
**Status:** Approved — Phase 0 in progress
**Goal:** Deploy vipbot to Cloudflare (Workers via OpenNext), keeping Prisma + MongoDB via Prisma Accelerate.

## Context (ground truth from the repo)

- **Stack:** Next.js 16.1.6 (App Router), React 19.2.3 + React Compiler, Prisma 6.19 → MongoDB Atlas (`mongodb+srv://`), raw-`fetch` Telegram **webhook** bot, 4 cron Route Handlers (`api/cron/*`), Paystack payments + MetaCopier REST, `node:crypto` AES-256-CBC (`src/lib/encryption.ts`).
- **Currently live on Vercel** (`telegram-subscrption-manager.vercel.app`).
- **Cloudflare Pages project** `telegram-subscrption-manager` already connected to GitHub (`chuchu2005/TELEGRAM-SUBSCRPTION-MANAGER`). Build compiles; **deploy fails** on `Service binding 'WORKER_SELF_REFERENCE' references Worker 'vipbot' which was not found [code 10143]`.
- **Root cause of deploy error:** Cloudflare auto-generates the OpenNext worker config (no `wrangler.jsonc`/`open-next.config.ts` is committed). The auto-generated self-reference names the Worker `vipbot` (from `package.json` `"name"`), but the Pages project deploys the script as `telegram-subscrption-manager` → name mismatch.
- **Cron:** GitHub Actions (`send-reminders.yml`, `remove-expired.yml`) `curl ${{ secrets.PRODUCTION_URL }}/api/cron/...`. Triggers for `send-broadcast` and `send-referral-stats` are **unknown** (no `vercel.json` in repo).

## Decisions

1. **Database:** Prisma Accelerate — keep Prisma client API + MongoDB Atlas; change only the connection layer (`src/lib/prisma.ts` + env). No route-file rewrites.
2. **Verification:** Production-only (no staging). Risk is mitigated because Vercel remains live & untouched through Phases 0–2; the only live-affecting step is the Phase 3 webhook cutover.
3. **Broadcast fan-out:** Deferred — decide Queues vs chunked after Phases 0–1.

## Hard constraints (verified)

- Prisma's MongoDB connector (Rust query engine, **no driver adapter**) cannot run in the Workers V8 isolate → **Accelerate is mandatory** to keep Prisma+MongoDB.
- OpenNext peer range: `next >=15.5.21 <16 || >=16.2.11` → **must bump from 16.1.6 to ≥16.2.11** (target: 16.2.12).
- `node:crypto` AES works under `nodejs_compat` + `compatibility_date >= "2024-09-23"` → `encryption.ts` needs **no change**.
- OpenNext supports App Router, Route Handlers, Server Actions, ISR, SSR — fits the app's architecture.

## Phases

### Phase 0 — Deploy fix (build config only; no live impact)
- Bump `next` + `eslint-config-next` → **16.2.12**.
- Add devDeps: `@opennextjs/cloudflare@1.20.2`, `wrangler@4.116.0`.
- Add `open-next.config.ts` (committed).
- Add `wrangler.jsonc` with `name: "telegram-subscrption-manager"` (kills the self-binding mismatch), `compatibility_date: "2024-09-23"`, `compatibility_flags: ["nodejs_compat"]`, `main: ".open-next/worker-dir/index.js"`, assets binding.
- Add `npm run build:cf` = `prisma generate && opennextjs-cloudflare build`; CF dashboard build command → `npm run build:cf`, deploy → `npx wrangler deploy`.
- Verify locally: `npm install && npm run build:cf` produces `.open-next/`; `wrangler deploy --dry-run` passes.

### Phase 1 — Runtime (Accelerate)
- Add dep `@prisma/extension-accelerate@3.0.1`.
- `src/lib/prisma.ts`: `new PrismaClient().$extends(withAccelerate())`.
- `schema.prisma`: add `directUrl = env("DIRECT_DATABASE_URL")` for migrations; keep `url = env("DATABASE_URL")` (Accelerate URL).
- Env (Cloudflare **and** Vercel — both deploy from this repo): `DATABASE_URL` = Accelerate proxy URL; `DIRECT_DATABASE_URL` = `mongodb+srv://...`.
- User action: enable Accelerate on Prisma Data Platform for the MongoDB cluster (steps provided).
- Verify query-by-query that all Prisma calls (incl. relations) work through Accelerate.

### Phase 2 — Cron & broadcast
- Repoint GitHub Actions `PRODUCTION_URL` → Cloudflare URL (covers `send-reminders`, `remove-expired`).
- Confirm/add triggers for `send-broadcast` + `send-referral-stats` (GH Actions or CF Cron Triggers).
- Broadcast fan-out → Queues or chunked (decision deferred).

### Phase 3 — Cutover (the only live-affecting step)
- Set all secrets in Cloudflare: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `PAYSTACK_SECRET_KEY`, `ENCRYPTION_KEY`, `METACOPIER_*`, `CRON_SECRET`, `DATABASE_URL`, `DIRECT_DATABASE_URL`, `ADMIN_ID`, `NEXT_PUBLIC_APP_URL`.
- Repoint Telegram + Paystack webhooks to the Cloudflare URL.
- Keep Vercel live as hot rollback until Cloudflare is verified end-to-end, then cut over.

## Safety rails
- Vercel untouched through Phase 0–2 (no commits/pushes until ready).
- Accelerate path behind an env toggle for canary/rollback if needed.
- Cloudflare instant rollback to a prior deployment version.
- Verify Accelerate query parity **before** Phase 3 cutover.

## Risks / open questions
1. **Accelerate + MongoDB query parity** for relations/complex queries — highest runtime risk; verify before cutover.
2. **`send-broadcast` / `send-referral-stats` trigger source** unknown (no `vercel.json`).
3. 5,800-line webhook handler per-request subrequest count on Workers.
4. Whether CF auto-build fully respects a committed `wrangler.jsonc` (expected yes; verify in Phase 0).
5. Phase 1 Accelerate change also redeploys to Vercel on push → both platforms' env vars must be updated together.

## Out of scope
- Rewriting Prisma queries (preserved via Accelerate).
- Migrating off MongoDB.
- Changing broadcast logic beyond the fan-out mechanism.
