/**
 * config/env.ts
 *
 * Zod-validated typed environment variable loader.
 * Fails fast at startup with a clear, human-readable error message
 * if any required variable is missing or malformed.
 *
 * Called once in index.ts before anything else.
 * All other modules import `env` from here — never from process.env directly.
 *
 * NOTE: Webhook / HTTP server variables are intentionally absent.
 *       This bot uses long polling only. No Express, no HTTP listener.
 */

import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  // ── Required ─────────────────────────────────────────────────────────────────
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required — get it from @BotFather"),

  // ── Redis (connects to the VPS's native redis-server, NOT a container) ───────
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),

  // ── i18n ─────────────────────────────────────────────────────────────────────
  DEFAULT_LOCALE: z.enum(["id", "en"]).default("id"),

  // ── Runtime ──────────────────────────────────────────────────────────────────
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),

  // ── Phase 7: Ops & Monitoring ─────────────────────────────────────────────
  //
  // OPS_CHANNEL_ID — Telegram channel ID for bot-operator crash/memory alerts.
  //   Intentionally different from the per-group !setlogchannel log channel:
  //   that one is per-group moderation history configured by group admins;
  //   this one is bot-operational health configured once by whoever runs the bot.
  //   If unset, alerting is silently skipped — no error.
  OPS_CHANNEL_ID: z.coerce.number().int().nullable().default(null),

  // OWNER_ID — The single Telegram user ID allowed to run /health.
  //   Deliberately not tied to group-admin status — group admins should not see
  //   internal technical diagnostics (memory, Redis, scheduler internals).
  //   If unset, /health refuses everyone unconditionally.
  OWNER_ID: z.coerce.number().int().nullable().default(null),

  // AUDIT_LOG_RETENTION_DAYS — How many days of JSONL audit logs to keep on disk.
  //   Files older than this (based on filename date, not mtime) are pruned daily.
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  • ${String(issue.path.join("."))}: ${issue.message}`,
    );
    console.error(
      `[startup] Invalid environment variables:\n${lines.join("\n")}\n\n` +
        `Copy .env.example → .env and fill in the required values.`,
    );
    process.exit(1);
  }

  return result.data;
}

/** Singleton env object — import this everywhere instead of process.env. */
export const env = loadEnv();
