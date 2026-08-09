/**
 * features/mentions/admin-mention.ts
 *
 * @admin mention relay — Phase 3 placeholder.
 *
 * Phase 0: This file is a stub. The handler is NOT wired in bot.ts yet.
 *
 * Phase 3 implementation:
 *   1. Detect "@admin" in message text (case-insensitive)
 *   2. Fetch admin list via ctx.api.getChatAdministrators
 *      (use isGroupAdmin from admin-guard for cached version)
 *   3. For each admin, send DM (silently skip if DM is blocked / 403)
 *   4. Read enabled flag from ctx.groupSettings.features["adminMention"]
 */

import type { BotContext } from "../../types/context.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function adminMentionHandler(_ctx: BotContext): Promise<void> {
  // Phase 3 — not yet implemented. See roadmap.
}
