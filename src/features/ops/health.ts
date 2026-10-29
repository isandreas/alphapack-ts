/**
 * features/ops/health.ts
 *
 * /health — DM-only, owner-only bot health command.
 *
 * Access model:
 *   - DM only: refuses in groups with a clear i18n message (health_dm_only).
 *   - Owner check: ctx.from.id must equal env.OWNER_ID. Anyone else —
 *     including verified group admins — gets a generic "not authorized" reply
 *     (error_owner_only). The response deliberately does NOT hint that a
 *     privileged command exists. If OWNER_ID is unset, refuses everyone.
 *   - Per-owner cooldown: 60 seconds (Redis key with TTL). On cooldown,
 *     replies with health_cooldown showing remaining seconds — explicit is
 *     more useful than silent for a diagnostic command you might genuinely retry.
 *
 * Report includes:
 *   - Process uptime (human-readable)
 *   - RSS and heap-used vs 256 MB PM2 cap, with ⚠️ if either exceeds 80%
 *   - Live Redis PING (not assumed-connected)
 *   - Node.js version + NODE_ENV
 *   - Last scheduler sweep time (from Redis key written by action-scheduler.ts)
 *
 * This is a manual, on-demand check. Automatic monitoring is in ops-alert.ts.
 * No HTTP server, no webhook, no side effects — just a Telegram reply.
 */

import type { BotContext } from "../../types/context.js";
import { env } from "../../config/env.js";
import { getRedisClient, healthcheck } from "../../db/redis.js";
import { healthCooldownKey, schedulerLastRunKey } from "../../db/keys.js";

// PM2 heap cap from ecosystem.config.js: --max-old-space-size=256
const HEAP_CAP_MB = 256;
const HEAP_CAP_BYTES = HEAP_CAP_MB * 1024 * 1024;
const MEMORY_WARN_RATIO = 0.8;

const HEALTH_COOLDOWN_S = 60;

// ── Formatters ────────────────────────────────────────────────────────────────

/**
 * Converts process.uptime() seconds into a human-readable string.
 * Examples: "3d 4h 12m", "45m 3s", "8s"
 */
function formatUptime(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const sec = s % 60;

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  // Show seconds only when the total is under one minute (avoid "3d 4h 12m 7s" noise)
  if (parts.length === 0) parts.push(`${sec}s`);

  return parts.join(" ");
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function healthCommandHandler(ctx: BotContext): Promise<void> {
  // 1. DM-only guard
  if (ctx.chat?.type !== "private") {
    await ctx.reply(ctx.t("health_dm_only"));
    return;
  }

  const userId = ctx.from?.id;
  if (!userId) return;

  // 2. Owner check — same response for everyone who isn't the configured owner,
  //    including verified group admins. Deliberately vague: don't confirm that
  //    a privileged command exists.
  if (env.OWNER_ID === null || userId !== env.OWNER_ID) {
    await ctx.reply(ctx.t("error_owner_only"));
    return;
  }

  // 3. Per-owner cooldown (60 s)
  const redis = getRedisClient();
  const cdKey = healthCooldownKey(userId);
  const ttl = await redis.ttl(cdKey);

  if (ttl > 0) {
    // TTL is the remaining seconds; tell the owner exactly how long to wait.
    await ctx.reply(ctx.t("health_cooldown", { seconds: String(ttl) }));
    return;
  }

  // Set cooldown BEFORE doing the live checks so a slow Redis PING doesn't
  // let a second invocation slip through before the first reply lands.
  await redis.set(cdKey, "1", "EX", HEALTH_COOLDOWN_S);

  // 4. Gather metrics ─────────────────────────────────────────────────────────

  const uptimeSeconds = process.uptime();
  const mem = process.memoryUsage();

  const rssWarn = mem.rss > HEAP_CAP_BYTES * MEMORY_WARN_RATIO;
  const heapWarn = mem.heapUsed > HEAP_CAP_BYTES * MEMORY_WARN_RATIO;

  // Live Redis PING — not "assumed connected"
  const redisOk = await healthcheck();

  // Last scheduler sweep time
  let lastRunStr = "never (scheduler has not run yet)";
  try {
    const raw = await redis.get(schedulerLastRunKey());
    if (raw) {
      const ts = parseInt(raw, 10) * 1000;
      const agoS = Math.floor((Date.now() - ts) / 1_000);
      const utcStr = new Date(ts).toISOString().replace("T", " ").substring(0, 19);
      lastRunStr = `${formatUptime(agoS)} ago (${utcStr} UTC)`;
    }
  } catch {
    lastRunStr = "unknown (Redis error)";
  }

  // 5. Build report ───────────────────────────────────────────────────────────

  const rssLine = `${formatMb(mem.rss)} / ${HEAP_CAP_MB} MB${rssWarn ? " ⚠️ >80%" : " ✅"}`;
  const heapLine = `${formatMb(mem.heapUsed)} / ${HEAP_CAP_MB} MB${heapWarn ? " ⚠️ >80%" : " ✅"}`;

  const report = [
    `🤖 <b>AlphaPack Health Report</b>`,
    ``,
    `<b>Uptime:</b> ${formatUptime(uptimeSeconds)}`,
    `<b>RSS:</b> ${rssLine}`,
    `<b>Heap used:</b> ${heapLine}`,
    `<b>Redis:</b> ${redisOk ? "✅ PONG" : "❌ unreachable"}`,
    `<b>Node:</b> ${process.version}`,
    `<b>Env:</b> ${env.NODE_ENV}`,
    `<b>Scheduler last run:</b> ${lastRunStr}`,
  ].join("\n");

  await ctx.reply(report, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}
