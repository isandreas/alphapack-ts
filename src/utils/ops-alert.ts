/**
 * utils/ops-alert.ts
 *
 * Operator-facing alerting: posts concise error summaries and memory warnings
 * to the configured OPS_CHANNEL_ID Telegram channel.
 *
 * Design principles:
 *   - Degrades gracefully when OPS_CHANNEL_ID is unset — pino logging always
 *     happens; Telegram posting is a convenience on top, never the only record.
 *   - Alert deduplication: same error message → at most one alert per 5 minutes,
 *     so a crash-loop doesn't flood the ops channel.
 *   - Memory alert: at most one alert per hour while still above threshold.
 *   - Never throws — if posting to the channel fails, logs via pino only.
 *
 * Memory cap reference: --max-old-space-size=256 in ecosystem.config.js → 256 MB.
 * 80% threshold = 204.8 MB RSS.
 */

import type { Api } from "grammy";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { getRedisClient } from "../db/redis.js";

// ── Bot API reference ─────────────────────────────────────────────────────────

let _api: Api | null = null;

/**
 * Registers the bot API for standalone ops-alert use.
 * Call this once in createBot() alongside registerBotApi().
 */
export function registerOpsApi(api: Api): void {
  _api = api;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** One alert per distinct error message per 5 minutes. */
const ERROR_ALERT_COOLDOWN_S = 300;

/** One memory alert per hour while still above threshold. */
const MEMORY_ALERT_COOLDOWN_S = 3_600;
const MEMORY_ALERT_CD_KEY = "alphapack:ops:memory_alert_cd";

/** Check memory every 5 minutes. */
const MEMORY_CHECK_INTERVAL_MS = 5 * 60 * 1_000;

/** PM2 heap cap from ecosystem.config.js: --max-old-space-size=256 */
const HEAP_CAP_MB = 256;
const HEAP_CAP_BYTES = HEAP_CAP_MB * 1024 * 1024;

/** Alert when RSS exceeds 80% of the heap cap (204.8 MB). */
const MEMORY_WARN_THRESHOLD_BYTES = Math.floor(HEAP_CAP_BYTES * 0.8);

// ── Error Alert ───────────────────────────────────────────────────────────────

/**
 * Builds a stable Redis key for alert deduplication.
 * Keyed on error name + first 80 chars of message — stable across occurrences
 * of the same logical error while keeping the key short and Redis-safe.
 */
function alertCooldownKey(errorName: string, message: string): string {
  const slug = `${errorName}:${message}`
    .substring(0, 80)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_:]/g, "");
  return `alphapack:ops:alert_cd:${slug}`;
}

/**
 * Posts a concise error alert to the ops channel.
 *
 * - pino receives the FULL error regardless (channel is supplementary).
 * - Deduplicates: same error type+message → at most one alert per 5 minutes.
 * - Sends only the first 4 stack lines, not a full dump.
 * - Silent no-op if OPS_CHANNEL_ID is unset or bot API not yet registered.
 */
export async function sendOpsAlert(error: unknown): Promise<void> {
  if (!env.OPS_CHANNEL_ID || !_api) return;

  const e = error instanceof Error ? error : new Error(String(error));
  const message = e.message || "Unknown error";

  // Deduplicate via Redis TTL key
  try {
    const redis = getRedisClient();
    const cdKey = alertCooldownKey(e.name, message);
    const alreadySent = await redis.get(cdKey);
    if (alreadySent) return;
    await redis.set(cdKey, "1", "EX", ERROR_ALERT_COOLDOWN_S);
  } catch {
    // Redis may itself be the error source — skip dedup, post unconditionally.
  }

  // First 4 stack lines only — enough context without burying the useful bits
  const stackLines = (e.stack ?? "").split("\n").slice(0, 4).join("\n");
  const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);

  const text = [
    `🚨 <b>Bot Error</b>`,
    `<b>Type:</b> <code>${escapeHtml(e.name)}</code>`,
    `<b>Message:</b> <code>${escapeHtml(message.substring(0, 200))}</code>`,
    `<b>Stack:</b>\n<pre>${escapeHtml(stackLines)}</pre>`,
    `<b>Time:</b> ${timestamp} UTC`,
  ].join("\n");

  try {
    await _api.sendMessage(env.OPS_CHANNEL_ID, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (sendErr) {
    logger.warn(
      { event: "ops_alert_send_failed", sendErr },
      "Failed to post error alert to ops channel",
    );
  }
}

// ── Memory Alert ──────────────────────────────────────────────────────────────

/**
 * Logs a memory warning via pino and (if OPS_CHANNEL_ID is set) posts to the
 * ops channel — at most once per hour while RSS remains above threshold.
 */
export async function sendMemoryAlert(rssBytes: number): Promise<void> {
  const rssMb = (rssBytes / 1024 / 1024).toFixed(1);
  const pct = ((rssBytes / HEAP_CAP_BYTES) * 100).toFixed(1);

  // pino log always happens regardless of ops channel config
  logger.warn(
    { event: "memory_warning", rss_mb: rssMb, heap_cap_mb: HEAP_CAP_MB, pct },
    `Memory RSS ${rssMb} MB (${pct}%) exceeds 80% of ${HEAP_CAP_MB} MB heap cap`,
  );

  if (!env.OPS_CHANNEL_ID || !_api) return;

  // One alert per hour while over threshold
  try {
    const redis = getRedisClient();
    const alreadySent = await redis.get(MEMORY_ALERT_CD_KEY);
    if (alreadySent) return;
    await redis.set(MEMORY_ALERT_CD_KEY, "1", "EX", MEMORY_ALERT_COOLDOWN_S);
  } catch {
    // Redis down — still attempt the Telegram post
  }

  const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);

  const text = [
    `⚠️ <b>Memory Warning</b>`,
    `<b>RSS:</b> ${rssMb} MB (${pct}% of ${HEAP_CAP_MB} MB cap)`,
    `<b>Time:</b> ${timestamp} UTC`,
    `<i>PM2 will auto-restart at 300 MB.</i>`,
  ].join("\n");

  try {
    await _api.sendMessage(env.OPS_CHANNEL_ID, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (sendErr) {
    logger.warn(
      { event: "ops_memory_alert_send_failed", sendErr },
      "Failed to post memory alert to ops channel",
    );
  }
}

// ── Memory Monitor ────────────────────────────────────────────────────────────

/**
 * Starts a setInterval that checks process RSS every 5 minutes.
 * Posts to the ops channel (1-hour cooldown) if RSS exceeds 80% of
 * the configured --max-old-space-size=256 MB cap (204.8 MB).
 *
 * Returns the handle so callers can clearInterval on graceful shutdown.
 */
export function startMemoryMonitor(): NodeJS.Timeout {
  return setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > MEMORY_WARN_THRESHOLD_BYTES) {
      sendMemoryAlert(rss).catch((err: unknown) => {
        logger.error({ err, event: "memory_monitor_error" }, "Error in memory monitor");
      });
    }
  }, MEMORY_CHECK_INTERVAL_MS);
}

// ── Helper ────────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
