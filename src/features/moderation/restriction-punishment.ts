/**
 * features/moderation/restriction-punishment.ts
 *
 * Shared punishment logic for the alphabet filter (Part B) and the media
 * filter (Part C) introduced in Phase 6.
 *
 * Both filters call applyRestrictionPunishment() — one implementation, no
 * duplication. The punishment is: delete the offending message, kick the
 * sender (ban-then-unban so they can rejoin), send a group notice, and post
 * a log card to the configured audit channel.
 *
 * Deliberate omissions (out of scope for this pass, flagged for future review):
 *   - No DM notice to the kicked user (not requested; worth adding later if
 *     desired for parity with warn/ban DMs).
 *   - No escalation / warning step — every match is an immediate kick.
 *   - No edited-message scanning — only new messages are checked here.
 *     Edited-message evasion (posting clean text then editing in restricted
 *     content) is a known gap worth closing in a future pass.
 */

import type { BotContext } from "../../types/context.js";
import { postActionCard } from "../../middlewares/logger.js";
import { formatUserMention } from "../../utils/target-resolver.js";
import { logger } from "../../utils/logger.js";

/** Tag string used in the log card header. */
export type RestrictionTag = "ALPHABETKICK" | "MEDIAKICK";

/**
 * Applies the Phase 6 restriction punishment to the author of the current
 * message:
 *
 *   1. Deletes the offending message (silently if already gone).
 *   2. Kicks the user via banChatMember + unbanChatMember — allows rejoin.
 *   3. Sends a group notice: "Message Removed. Reason: [reason]".
 *   4. Posts a log card to the audit channel with the appropriate tag.
 *
 * @param ctx    Current update context (must have ctx.message set).
 * @param chatId Group chat ID.
 * @param userId Sender's user ID.
 * @param reason Human-readable reason string (appears in both the group
 *               notice and the log card).
 * @param tag    Log-card tag: "ALPHABETKICK" or "MEDIAKICK".
 */
export async function applyRestrictionPunishment(
  ctx: BotContext,
  chatId: number,
  userId: number,
  reason: string,
  tag: RestrictionTag,
): Promise<void> {
  const displayName =
    [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") ||
    "User";

  // ── 1. Delete the offending message ────────────────────────────────────────
  const messageId = ctx.message?.message_id;
  if (messageId) {
    try {
      await ctx.api.deleteMessage(chatId, messageId);
    } catch (err: unknown) {
      // Message may already be deleted by another handler or Telegram itself.
      // Log at debug level and continue — this must not block the kick.
      logger.debug(
        { event: "restriction_delete_failed", chatId, userId, messageId, err },
        "Failed to delete restricted message — continuing with kick",
      );
    }
  }

  // ── 2. Kick: ban immediately followed by unban ─────────────────────────────
  // This removes the user from the group but does NOT permanently ban them —
  // they can rejoin via invite link. Same pattern as Phase 3 captcha-timeout
  // kick. The kickBypassGoodbyeKey suppresses the goodbye-message handler.
  try {
    const { kickBypassGoodbyeKey } = await import("../../db/keys.js");
    const { getRedisClient } = await import("../../db/redis.js");
    const redis = getRedisClient();
    await redis.set(kickBypassGoodbyeKey(chatId, userId), "1", "EX", 10);
  } catch (err: unknown) {
    logger.warn(
      { event: "restriction_bypass_key_failed", chatId, userId, err },
      "Failed to set goodbye bypass key before kick",
    );
  }

  try {
    await ctx.api.banChatMember(chatId, userId);
    await ctx.api.unbanChatMember(chatId, userId);
  } catch (err: unknown) {
    logger.error(
      { event: "restriction_kick_failed", chatId, userId, err },
      "Failed to kick user during restriction punishment",
    );
    // Continue so the group notice and log card are still posted.
  }

  // ── 3. Group notice ────────────────────────────────────────────────────────
  // Uses ctx.t() so the message respects the group's configured locale.
  // The i18n middleware has already resolved the correct locale from
  // groupSettings.locale before this middleware chain runs.
  try {
    await ctx.api.sendMessage(
      chatId,
      ctx.t("reply_restriction_removed", { reason }),
    );
  } catch (err: unknown) {
    logger.warn(
      { event: "restriction_notice_failed", chatId, userId, err },
      "Failed to send group restriction notice",
    );
  }

  // ── 4. Log card ────────────────────────────────────────────────────────────
  // Format follows the same structural convention as #FLOODMUTE and
  // #CAPTCHAKICK: Admin = "System (Auto-Moderation)", no "Go to message"
  // button (the source message has been deleted so there is nothing to link).
  //
  // ⚠️  FLAG FOR REVIEW: The #ALPHABETKICK / #MEDIAKICK format below mirrors
  // the automated-action card pattern from earlier phases. It has not been
  // locked in the same way as #WARN / #TBAN / #BAN — confirm the exact
  // field set is acceptable before the next audit-log review.
  const targetLabel = formatUserMention(userId, displayName, ctx.from?.username);
  const groupTitle =
    ctx.chat && "title" in ctx.chat && ctx.chat.title
      ? ctx.chat.title
      : "Group";
  const dateStr = new Date().toISOString().replace("T", " ").substring(0, 19);

  const cardLines = [
    `<b>Action:</b> ${tag}`,
    `<b>Chat:</b> ${groupTitle} [<code>${chatId}</code>]`,
    `<b>User:</b> ${targetLabel}`,
    `<b>Admin:</b> System (Auto-Moderation)`,
    `<b>Date:</b> ${dateStr}`,
    `<b>Reason:</b> ${reason}`,
    `#${tag.toLowerCase()}`,
  ];

  // No replyMarkup — the offending message is already deleted, there is
  // nothing left to link to from the log channel.
  await postActionCard(chatId, cardLines.join("\n"));
}
