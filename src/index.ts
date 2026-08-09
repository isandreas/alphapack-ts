/**
 * index.ts — Entrypoint
 *
 * Startup sequence:
 *   1. Load & validate env vars (process.exit on failure — handled by env.ts)
 *   2. Connect Redis (process.exit with clear error if unreachable)
 *   3. Instantiate bot with all Phase 0 middleware
 *   4. Start grammY runner (long polling — NO webhook, NO HTTP server)
 *   5. Wire SIGTERM/SIGINT for graceful shutdown
 *
 * NOTE: Webhook mode is intentionally not implemented.
 *       Long polling via grammY runner is the only update transport.
 *       If webhook support is needed in a future phase, it must be
 *       explicitly scoped and approved — do not add it here.
 */

import { run } from "@grammyjs/runner";
import { createBot } from "./bot.js";
import { connect, closeRedisClient, healthcheck } from "./db/redis.js";
import { logger } from "./utils/logger.js";
import { startScheduler } from "./features/scheduler/action-scheduler.js";

async function main(): Promise<void> {
  logger.info({ event: "startup_begin" }, "AlphaPack starting up…");

  // ── 1. Redis connection ──────────────────────────────────────────────────
  // connect() exits the process with a clear diagnostic if Redis is down.
  // We deliberately fail fast here: without Redis, session storage is broken
  // and the bot would silently malfunction.
  await connect();

  // Verify the connection is actually ready (not just TCP-open)
  const healthy = await healthcheck();
  if (!healthy) {
    logger.fatal(
      { event: "redis_healthcheck_failed" },
      "Redis PING failed after connect — aborting. Check redis-server status.",
    );
    process.exit(1);
  }
  logger.info({ event: "redis_ready" }, "Redis healthcheck passed ✓");

  // ── 2. Bot instantiation ─────────────────────────────────────────────────
  const bot = createBot();

  // ── 3. grammY Runner (long polling) ─────────────────────────────────────
  // Fetches updates from Telegram using getUpdates (long polling).
  // grammY runner handles:
  //   - Concurrent update processing (bounded by sequentialize ordering)
  //   - Automatic retry on transient network errors
  //   - Graceful drain on stop()
  //
  // allowed_updates: only subscribe to update types the bot actually handles.
  // This reduces bandwidth and Telegram-side queueing overhead.
  const runner = run(bot, {
    runner: {
      fetch: {
        allowed_updates: [
          "message",
          "edited_message",
          "callback_query",
          "chat_member",
          "my_chat_member",
        ],
      },
    },
  });

  logger.info({ event: "bot_running" }, "AlphaPack is running ✓  (long polling, no webhook)");

  // ── 3.5 Start Scheduler ──────────────────────────────────────────────────
  const schedulerInterval = startScheduler(bot);

  // ── 4. Graceful shutdown ─────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(
      { event: "shutdown_signal", signal },
      `${signal} received — draining updates and shutting down`,
    );

    clearInterval(schedulerInterval);

    if (runner.isRunning()) {
      await runner.stop();
      logger.info({ event: "runner_stopped" }, "grammY runner stopped");
    }

    await closeRedisClient();

    logger.info({ event: "shutdown_complete" }, "Shutdown complete. Goodbye.");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // ── 5. Crash guards ──────────────────────────────────────────────────────
  process.on("unhandledRejection", (reason: unknown) => {
    logger.fatal(
      { event: "unhandled_rejection", reason },
      "Unhandled Promise rejection — PM2 will restart if needed",
    );
    // Do NOT exit here — let PM2's max_memory_restart handle restart policy.
    // Exiting here would abort any in-flight update processing.
  });

  process.on("uncaughtException", (err: Error) => {
    logger.fatal(
      { event: "uncaught_exception", name: err.name, message: err.message, stack: err.stack },
      "Uncaught exception — exiting",
    );
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  // This catches synchronous throws or rejections from the startup sequence
  // (e.g. env validation failure, which calls process.exit(1) itself).
  console.error("[startup] Fatal error:", err);
  process.exit(1);
});
