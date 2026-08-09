import type { BotContext } from "../../types/context.js";

/**
 * /tban (temporary ban) handler — Phase 2
 *
 * TODO:
 *   1. Parse required duration arg (error if missing)
 *   2. Resolve target user from reply
 *   3. Guard: cannot tban admins / self / bot
 *   4. Call ctx.api.banChatMember with until_date = now + duration
 *   5. Store tban record in Redis (tbanKey, TTL = duration)
 *   6. Schedule unban job via unban-scheduler.ts
 *   7. Reply with banned (timed) i18n string
 *   8. Emit structured log, post action card, DM target
 */
export async function tbanHandler(_ctx: BotContext): Promise<void> {
  // TODO: implement in Phase 2
  throw new Error("tbanHandler not yet implemented");
}
