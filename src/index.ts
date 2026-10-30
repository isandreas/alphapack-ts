/**
 * index.ts — Entrypoint
 *
 * Startup sequence:
 *   1. Load & validate env vars (process.exit on failure — handled by env.ts)
 *   2. Connect Redis (process.exit with clear error if unreachable)
 *   3. Instantiate bot with all middleware
 *   4. Start grammY runner (long polling — NO webhook, NO HTTP server)
 *   5. Start scheduler (unmute/unban/captcha-kick sweep every 30 s)
 *   6. Start memory monitor (RSS check every 5 min, alerts ops channel if >80%)
 *   7. Wire SIGTERM/SIGINT for graceful shutdown
 *   8. Wire unhandledRejection/uncaughtException crash guards with ops alerting
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
import { startMemoryMonitor, sendOpsAlert } from "./utils/ops-alert.js";
import { cleanupOldAuditLogs } from "./utils/audit-log.js";
import { checkExistingGroupsOnStartup } from "./features/settings/group-registry.js";

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
  // createBot() also calls registerOpsApi(bot.api) so sendOpsAlert can post
  // to the ops channel from anywhere after this point.
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

  // ── 3.4 Check existing known groups for owner approval ───────────────────
  // If the bot is already in group(s) when this feature releases, prompt the
  // owner in DM for approval for each unapproved group.
  checkExistingGroupsOnStartup(bot.api).catch((err: unknown) => {
    logger.warn(
      { err, event: "startup_group_approval_error" },
      "Startup group approval check failed",
    );
  });

  // ── 3.5 Start Scheduler ──────────────────────────────────────────────────
  const schedulerInterval = startScheduler(bot);

  // ── 3.6 Start Memory Monitor (Phase 7) ──────────────────────────────────
  // Checks process.memoryUsage().rss every 5 minutes. Posts a single alert
  // to OPS_CHANNEL_ID (1-hour cooldown) when RSS exceeds 80% of the 256 MB
  // heap cap configured in ecosystem.config.js.
  const memoryMonitorInterval = startMemoryMonitor();

  // ── 3.7 Audit Log Retention Cleanup (Phase 7) ────────────────────────────
  // Run once eagerly at startup to handle any backlog from missed runs,
  // then every 24 hours. Deletes logs/audit/YYYY-MM-DD.jsonl files older
  // than AUDIT_LOG_RETENTION_DAYS (default 30), keyed on filename date.
  cleanupOldAuditLogs().catch((err: unknown) => {
    logger.warn({ err, event: "audit_cleanup_startup_error" }, "Startup audit log cleanup failed");
  });
  const auditCleanupInterval = setInterval(() => {
    cleanupOldAuditLogs().catch((err: unknown) => {
      logger.warn({ err, event: "audit_cleanup_error" }, "Daily audit log cleanup failed");
    });
  }, 24 * 60 * 60 * 1_000); // 24 hours

  // ── 4. Graceful shutdown ─────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(
      { event: "shutdown_signal", signal },
      `${signal} received — draining updates and shutting down`,
    );

    clearInterval(schedulerInterval);
    clearInterval(memoryMonitorInterval);
    clearInterval(auditCleanupInterval);


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
  // pino logs the full error in all cases. sendOpsAlert posts a concise
  // summary to OPS_CHANNEL_ID (rate-limited, no-op if unconfigured).

  process.on("unhandledRejection", (reason: unknown) => {
    logger.fatal(
      { event: "unhandled_rejection", reason },
      "Unhandled Promise rejection — PM2 will restart if needed",
    );
    // Fire-and-forget: sendOpsAlert never throws, so this is safe in a sync handler.
    sendOpsAlert(reason).catch(() => {});
    // Do NOT exit here — let PM2's max_memory_restart handle restart policy.
    // Exiting here would abort any in-flight update processing.
  });

  process.on("uncaughtException", (err: Error) => {
    logger.fatal(
      { event: "uncaught_exception", name: err.name, message: err.message, stack: err.stack },
      "Uncaught exception — exiting",
    );
    // Best-effort alert before exit. We don't await because the process is
    // about to exit — the bot API call may or may not complete in time.
    sendOpsAlert(err).catch(() => {});
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  // This catches synchronous throws or rejections from the startup sequence
  // (e.g. env validation failure, which calls process.exit(1) itself).
  console.error("[startup] Fatal error:", err);
  process.exit(1);
});
