/**
 * utils/audit-log.ts
 *
 * Flat-file JSONL audit log — a local disk backup of every action card.
 *
 * Design notes:
 *   - One file per calendar day: logs/audit/YYYY-MM-DD.jsonl
 *   - Writes happen in real time as actions occur, piggybacking on the existing
 *     postActionCard() call site — no separate logging path.
 *   - Disk-based, NOT Redis-based. This is intentional: the VPS has 768 MB RAM;
 *     keeping audit history on disk costs nothing from that budget.
 *     Expected footprint at this project's scale (small groups, low volume):
 *     < 1 MB/day. Would need revisiting only if volume grew to thousands of
 *     moderation actions per day.
 *   - The Telegram log channel (per-group, configured by admins via !setlogchannel)
 *     remains the primary human-facing audit trail. This is a supplementary raw
 *     record for the bot operator to grep on the VPS if needed.
 *   - No /auditlog command — files are meant for direct cat/grep access.
 *
 * Retention:
 *   - cleanupOldAuditLogs() deletes files where the filename date is older than
 *     AUDIT_LOG_RETENTION_DAYS (default 30). Run once daily.
 *   - Uses filename date (not filesystem mtime) for predictable, reproducible behavior.
 */

import * as fs from "fs";
import * as path from "path";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

// ── Path helpers ──────────────────────────────────────────────────────────────

/** Base directory for audit logs. Relative to the process working directory
 *  (the project root when started via PM2 or npm run dev). */
const AUDIT_DIR = path.join(process.cwd(), "logs", "audit");

/** Formats a Date as YYYY-MM-DD for use in filenames. */
function datestamp(d: Date): string {
  return d.toISOString().substring(0, 10); // "2026-08-30"
}

/** Full path to today's audit log file. */
function todayLogPath(): string {
  return path.join(AUDIT_DIR, `${datestamp(new Date())}.jsonl`);
}

// Ensure the audit directory exists once at module load.
// Using sync here is intentional: it runs at import time, before any async
// event loop activity, so there is no risk of a race with the first write.
try {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
} catch (err) {
  logger.warn({ err, event: "audit_log_mkdir_failed", dir: AUDIT_DIR }, "Could not create audit log directory");
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Appends one JSONL record to today's audit log file.
 *
 * Record shape:
 *   { "timestamp": "ISO8601", "chatId": number, "card": "HTML string" }
 *
 * Called from postActionCard() in middlewares/logger.ts — this is the ONLY
 * write path. There is no periodic batching.
 *
 * Uses async appendFile with a catch so a disk error never propagates to the
 * caller and never blocks the Telegram send.
 */
export function appendAuditLog(chatId: number, card: string): void {
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    chatId,
    card,
  });

  fs.promises
    .appendFile(todayLogPath(), record + "\n", "utf8")
    .catch((err: unknown) => {
      logger.warn(
        { err, event: "audit_log_write_failed", chatId },
        "Failed to append to audit log file",
      );
    });
}

// ── Retention cleanup ─────────────────────────────────────────────────────────

/**
 * Deletes audit log files older than AUDIT_LOG_RETENTION_DAYS.
 * Uses filename date (YYYY-MM-DD), not filesystem mtime, for predictability.
 *
 * Safe to call if the directory doesn't exist yet (e.g. on a fresh install
 * before any actions have been logged).
 *
 * Intended to be called once per day from index.ts.
 */
export async function cleanupOldAuditLogs(): Promise<void> {
  let files: string[];
  try {
    files = await fs.promises.readdir(AUDIT_DIR);
  } catch {
    // Directory doesn't exist yet — nothing to clean up.
    return;
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - env.AUDIT_LOG_RETENTION_DAYS);
  // Zero out the time component so we compare dates, not datetimes.
  cutoff.setUTCHours(0, 0, 0, 0);

  let deleted = 0;
  for (const file of files) {
    const match = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file);
    if (!match) continue; // ignore unexpected files in the directory

    const fileDate = new Date(match[1] + "T00:00:00Z");
    if (fileDate < cutoff) {
      try {
        await fs.promises.unlink(path.join(AUDIT_DIR, file));
        deleted++;
        logger.debug({ event: "audit_log_pruned", file }, `Pruned audit log: ${file}`);
      } catch (err) {
        logger.warn({ err, event: "audit_log_prune_failed", file }, `Failed to prune audit log: ${file}`);
      }
    }
  }

  if (deleted > 0) {
    logger.info({ event: "audit_log_cleanup", deleted }, `Pruned ${deleted} old audit log file(s)`);
  }
}
