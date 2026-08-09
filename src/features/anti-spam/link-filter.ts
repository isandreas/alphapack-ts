import type { BotContext } from "../../types/context.js";

/**
 * Link Filter — Phase 2
 *
 * TODO:
 *   1. Read block_links from ctx.groupSettings.anti_spam
 *   2. Skip if sender is admin
 *   3. Detect URLs via message.entities (type === "url" / "text_link")
 *   4. Detect @mentions via entities (type === "mention")
 *   5. Delete offending message + optionally warn user
 */
export async function linkFilter(_ctx: BotContext): Promise<void> {
  // TODO: implement in Phase 2
}
