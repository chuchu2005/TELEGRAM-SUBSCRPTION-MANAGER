// vipbot-cron — scheduled trigger for the vipbot app's cron endpoints.
//
// Contains NO app logic: on a schedule (or via the manual /run route) it POSTs
// to the main app's /api/cron/* handlers through a service binding (env.MAIN).
//
// Two kinds of jobs:
//   • DIRECT — one cron expression -> one endpoint (remove-expired, reminders…).
//   • WINDOWS — a broadcast that should land somewhere inside a ~60-min window
//     and at a DIFFERENT minute each day (so it doesn't feel automated). Each
//     window has N cron slots; per day exactly one slot is the "winner" chosen
//     deterministically from the date, and only that slot fires the broadcast.
//
// All cron expressions are UTC. Broadcast targets are Nigerian (WAT = UTC+1).

// cron expression -> endpoint (fires every time)
const DIRECT = {
  "0 * * * *": "/api/cron/remove-expired",
  "0 9 * * *": "/api/cron/send-reminders",     // 10am WAT
  "0 21 * * *": "/api/cron/send-referral-stats", // 10pm WAT
};

// Broadcast windows. `hour` is the ?hour= value the main app uses to pick copy.
// Each window's 5 slots span ~60 min around the target; one fires per day.
//   morning   9am WAT -> 07:30–08:30 UTC
//   tphit    12pm WAT -> 10:30–11:30 UTC
//   afternoon 3pm WAT -> 13:30–14:30 UTC
//   evening   9pm WAT -> 19:30–20:30 UTC
const WINDOWS = [
  { name: "morning",   hour: "9",  slots: ["30 7 * * *", "45 7 * * *", "0 8 * * *", "15 8 * * *", "30 8 * * *"] },
  { name: "tphit",     hour: "12", slots: ["30 10 * * *", "45 10 * * *", "0 11 * * *", "15 11 * * *", "30 11 * * *"] },
  { name: "afternoon", hour: "15", slots: ["30 13 * * *", "45 13 * * *", "0 14 * * *", "15 14 * * *", "30 14 * * *"] },
  { name: "evening",   hour: "21", slots: ["30 19 * * *", "45 19 * * *", "0 20 * * *", "15 20 * * *", "30 20 * * *"] },
];

// friendly name -> endpoint, for the manual /run route
const RUN_JOBS = {
  "remove-expired": "/api/cron/remove-expired",
  "send-reminders": "/api/cron/send-reminders",
  "referral-stats": "/api/cron/send-referral-stats",
  "morning": "/api/cron/send-broadcast?hour=9",
  "tphit": "/api/cron/send-broadcast?hour=12",
  "afternoon": "/api/cron/send-broadcast?hour=15",
  "evening": "/api/cron/send-broadcast?hour=21",
};

// Deterministic per-day slot pick: same date+window -> same slot, varies by date.
function todaysSlot(scheduledTime, windowName, numSlots) {
  let h = 0;
  const key = `${windowName}|${new Date(scheduledTime).toDateString()}`;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % numSlots;
}

async function hit(env, path, label = "[cron]", maxAttempts = 3) {
  // Call the main app via the service binding (same-account *.workers.dev
  // fetches 1042). Only a 2xx counts as success; retry on anything else.
  const url = `${env.MAIN_URL}${path}`;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await env.MAIN.fetch(url, { method: "POST" });
      const body = await res.text().catch(() => "");
      if (res.status >= 200 && res.status < 300) {
        console.log(`${label} ${path} -> ${res.status} ${body.slice(0, 120)}`);
        return { status: res.status, body };
      }
      console.warn(`${label} ${path} -> ${res.status} (attempt ${attempt}/${maxAttempts}); retrying`);
    } catch (err) {
      console.warn(`${label} ${path} threw (attempt ${attempt}/${maxAttempts}): ${err.message}`);
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  console.error(`${label} ${path} failed after ${maxAttempts} attempts`);
  return { status: 0, body: "failed after retries" };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/run/")) {
      const secret = request.headers.get("x-cron-secret") || url.searchParams.get("secret");
      if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
        return new Response("unauthorized\n", { status: 401 });
      }
      const job = url.pathname.slice("/run/".length);
      const path = RUN_JOBS[job];
      if (!path) return new Response(`unknown job '${job}'\n`, { status: 404 });
      const { status, body } = await hit(env, path, "[manual]");
      return new Response(`${path} -> ${status}\n${body.slice(0, 500)}\n`, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }

    return new Response(
      "vipbot-cron — scheduled-only worker. GET /run/<job>?secret=... to trigger manually.\n",
      { status: 200, headers: { "content-type": "text/plain" } },
    );
  },

  async scheduled(controller, env, ctx) {
    // 1) Direct (every-fire) jobs.
    const direct = DIRECT[controller.cron];
    if (direct) {
      ctx.waitUntil(hit(env, direct));
      return;
    }

    // 2) Broadcast window slots — only today's picked slot fires.
    for (const w of WINDOWS) {
      const idx = w.slots.indexOf(controller.cron);
      if (idx >= 0) {
        const pick = todaysSlot(controller.scheduledTime, w.name, w.slots.length);
        if (idx === pick) {
          console.log(`[cron] ${w.name}: slot ${idx} is today's pick -> sending hour=${w.hour}`);
          ctx.waitUntil(hit(env, `/api/cron/send-broadcast?hour=${w.hour}`));
        } else {
          console.log(`[cron] ${w.name}: slot ${idx} skipped (today's pick=${pick} of ${w.slots.length})`);
        }
        return;
      }
    }

    console.warn(`[cron] unhandled cron expression: ${controller.cron}`);
  },
};
