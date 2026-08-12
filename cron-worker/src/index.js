// vipbot-cron — scheduled trigger for the vipbot app's cron endpoints.
//
// This worker contains NO application logic. On a schedule (or via the manual
// /run route) it simply POSTs to the main app's existing /api/cron/* route
// handlers (the OpenNext worker at env.MAIN_URL). Keeping it separate means the
// OpenNext worker is never touched and cron timing is owned by Cloudflare.

// cron expression -> endpoint path (must match wrangler.jsonc triggers exactly).
// Cron runs in UTC. Broadcast intent is 8am/10am/8pm Nigerian (WAT = UTC+1),
// so those fire at 07:00/09:00/19:00 UTC. Reminders at 08:00 UTC (9am WAT) to
// avoid colliding with the 10am broadcast (both would otherwise be 09:00 UTC).
const ENDPOINTS = {
  "0 * * * *": "/api/cron/remove-expired",          // every hour
  "0 7 * * *": "/api/cron/send-broadcast?hour=8",   // 8am WAT
  "0 8 * * *": "/api/cron/send-reminders",          // 9am WAT
  "0 9 * * *": "/api/cron/send-broadcast?hour=10",  // 10am WAT
  "0 19 * * *": "/api/cron/send-broadcast?hour=20", // 8pm WAT
  "0 21 * * *": "/api/cron/send-referral-stats",    // 10pm WAT
};

// friendly name -> endpoint path, for the manual /run route
const RUN_JOBS = {
  "remove-expired": "/api/cron/remove-expired",
  "send-reminders": "/api/cron/send-reminders",
  "referral-stats": "/api/cron/send-referral-stats",
  "broadcast-8": "/api/cron/send-broadcast?hour=8",
  "broadcast-10": "/api/cron/send-broadcast?hour=10",
  "broadcast-20": "/api/cron/send-broadcast?hour=20",
};

async function hit(env, path, label = "[cron]", maxAttempts = 3) {
  // Call the main app via a service binding (env.MAIN), NOT a public-URL fetch
  // — same-account Worker-to-Worker fetches over *.workers.dev 1042. Only a 2xx
  // counts as success; retry on anything else (incl. transient CF blips).
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
  // Swallow final failure so ctx.waitUntil never rejects (avoids retry storms).
  console.error(`${label} ${path} failed after ${maxAttempts} attempts`);
  return { status: 0, body: "failed after retries" };
}

export default {
  // Health/manual: GET / returns info; GET /run/<job>?secret=<CRON_SECRET> fires a job now.
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
    const path = ENDPOINTS[controller.cron];
    if (!path) {
      console.warn(`[cron] unhandled cron expression: ${controller.cron}`);
      return;
    }
    ctx.waitUntil(hit(env, path));
  },
};
