import type { BotContext } from "../../types/context.js";

/**
 * @username Mention Handler
 *
 * When a user is @mentioned in a group message, send them a DM
 * with a deep-link button pointing back to the group message.
 *
 * TODO (Phase 2):
 *   1. Parse message.entities for type === "mention"
 *   2. Resolve @username → user_id via usernameMapKey Redis hash
 *   3. Build deep-link using privateGroupMessageLink()
 *   4. Send DM with InlineKeyboard "Go to message" button
 *   5. Silently skip if DM is blocked (403 error)
 *   6. Update username → user_id map from incoming messages (background task)
 */
export async function userMentionHandler(_ctx: BotContext): Promise<void> {
  // TODO: implement in Phase 2
}
