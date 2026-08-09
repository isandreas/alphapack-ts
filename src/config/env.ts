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
