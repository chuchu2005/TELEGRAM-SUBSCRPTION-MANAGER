# Cloudflare Cron Triggers — vipbot

**Date:** 2026-08-10
**Status:** Approved — implementing
**Goal:** Run vipbot's existing `/api/cron/*` endpoints on Cloudflare Cron Triggers, replacing the GitHub Actions + external-cron-site triggers.

## Context (ground truth)
- Four cron route handlers exist in the app: `remove-expired`, `send-reminders`, `send-broadcast` (takes `?hour=`), `send-referral-stats`.
- Pre-migration triggers: GitHub Actions (`send-reminders` daily 09:00 UTC, `remove-expired` hourly) and an external cron site (`send-broadcast` at hours 8/10/20). `send-referral-stats` had no known trigger.
- The app is deployed as an OpenNext Worker; OpenNext owns its `fetch` entry, so adding a `scheduled()` handler there is fragile. Cron Triggers must live in a **separate** worker.

## Decision
A small standalone worker `vipbot-cron` whose `scheduled()` handler POSTs to the main app's existing cron endpoints. The main app is **not modified** (no redeploy, no risk to the ngrok-vs-prod build-time URL).

### Schedules (all UTC), one cron expression per job (account is on Workers paid plan — no 3-trigger cap)
| Cron | Endpoint hit |
|---|---|
| `0 * * * *` | `/api/cron/remove-expired` |
| `0 8 * * *` | `/api/cron/send-broadcast?hour=8` |
| `0 10 * * *` | `/api/cron/send-broadcast?hour=10` |
| `0 20 * * *` | `/api/cron/send-broadcast?hour=20` |
| `0 9 * * *` | `/api/cron/send-reminders` |
| `0 21 * * *` | `/api/cron/send-referral-stats` |

`MAIN_URL` (the deployed OpenNext worker URL) is a plain wrangler `var`.

## Auth
Endpoints are left **unauthenticated**, matching today's behavior (deferred; would require a main-app code change + redeploy to enforce `CRON_SECRET`). Tracked as a separate hardening item alongside the unauthenticated Telegram webhook.

## Reliability notes
- Each `fetch` is wrapped so `ctx.waitUntil` never rejects (avoids silent cron failures).
- Broadcast fan-out stays in the main app (chunked self-pagination + `after()`); this worker only kicks it off.
- Cron Triggers are at-least-once; the endpoints must tolerate duplicate runs (broadcast already pages by offset — duplicates possible, same risk profile as the old external cron).

## Files
- `cron-worker/src/index.js` — the `scheduled()` handler.
- `cron-worker/wrangler.jsonc` — triggers + `MAIN_URL` var.

## Deploy
`npx wrangler deploy --config cron-worker/wrangler.jsonc`

## Rollback
Delete the `vipbot-cron` worker (or empty its triggers) and re-enable the GitHub Actions workflows / external cron site.

## Follow-ups
- Disable the two GitHub Actions cron workflows and the external broadcast cron once CF triggers are verified, to avoid double-runs.
- Harden cron endpoints + Telegram webhook with shared secrets.
