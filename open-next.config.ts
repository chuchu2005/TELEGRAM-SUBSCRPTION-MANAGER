// OpenNext config for deploying vipbot (Next.js 16) to Cloudflare Workers.
//
// This app is a Telegram bot backend with API routes + a couple of pages and
// uses NO ISR / static generation / revalidation, so the default cache is used
// and no R2 bucket binding is required.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
