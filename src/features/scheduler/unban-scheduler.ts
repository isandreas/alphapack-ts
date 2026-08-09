import { logger } from "../../utils/logger.js";

/**
 * Unban Scheduler — handles tban expiry
 *
 * Strategy (Phase 2):
 *   We use Redis TTL as the source of truth for ban expiry rather than
 *   an in-process timer, because the bot may restart before the timer fires.
 *
 *   On startup, this scheduler scans the pending unban set (pendingUnbanSetKey)
 *   and uses node-cron to poll for expired keys, then calls unbanChatMember.
 *
 *   Why node-cron instead of BullMQ?
 *   - BullMQ requires a dedicated worker process (extra RAM on a 768MB VPS).
 *   - Our use case is simple: one cron tick per minute, check Redis TTL keys.
 *   - BullMQ is a valid upgrade path if job volume grows significantly.
 *
 * TODO (Phase 2):
 *   1. Import node-cron (or use setInterval as simpler alternative)
 *   2. On each tick: SMEMBERS pendingUnbanSetKey → for each "<chatId>:<userId>":
 *        a. Check if tbanKey(chatId, userId) has expired (TTL === -2)
 *        b. If expired: call bot.api.unbanChatMember(chatId, userId)
 *        c. SREM from pending set + emit log
 *   3. Export startUnbanScheduler(bot) called from index.ts
 *
 * Memory note:
 *   SMEMBERS loads the full set into memory. If tban volume is high,
 *   switch to a Redis sorted set (ZRANGEBYSCORE by expiry timestamp)
 *   and ZSCAN to paginate — avoids loading the whole set at once.
 */
export function startUnbanScheduler(): void {
  logger.info(
    { event: "unban_scheduler_start" },
    "Unban scheduler started (Phase 2 placeholder — no-op)",
  );

  // TODO (Phase 2): implement cron-based polling
}
