/**
 * features/moderation/media-filter.ts
 *
 * Phase 6 — Media-type filter middleware.
 *
 * Checks new group messages for restricted media types (photo, video, sticker,
 * GIF/animation, or link). If ANY enabled category matches, the message is
 * deleted and the sender kicked exactly once — even if multiple categories
 * match simultaneously (e.g. a photo with a URL in its caption).
 *
 * Category → Telegram Bot API mapping:
 *
 *   Setting key | Matches when...
 *   ------------|-------------------------------------------------------
 *   photo       | message.photo is set
 *   video       | message.video is set
 *   sticker     | message.sticker is set (static, animated, video stickers
 *               |   are all one category — not split further)
 *   gif         | message.animation is set (Telegram has no separate "gif"
 *               |   type; GIFs sent via the GIF picker become animations)
 *   link        | message.entities or message.caption_entities contains an
 *               |   entry of type "url" or "text_link"
 *
 * Out of scope for this pass:
 *   - edited_message scanning (evasion risk — flag for future pass)
 *   - Splitting stickers into static vs animated/video categories
 */

import type { NextFunction } from "grammy";
import type { BotContext } from "../../types/context.js";
import { isAutoModerationExempt } from "../../utils/permissions.js";
import { applyRestrictionPunishment } from "./restriction-punishment.js";
import { logger } from "../../utils/logger.js";

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Media filter middleware (Phase 6).
 *
 * Install in bot.ts after alphabetFilterMiddleware.
 * Runs only on new messages in group/supergroup chats.
 */
export async function mediaFilterMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;

  // 1. Only run in group/supergroup chats on actual messages
  if (!chatId || !userId || ctx.chat?.type === "private") {
    return next();
  }

  if (!ctx.message) {
    return next();
  }

  // Skip system service messages
  const msg = ctx.message;
  if (
    msg.new_chat_members ||
    msg.left_chat_member ||
    msg.pinned_message ||
    msg.group_chat_created ||
    msg.supergroup_chat_created
  ) {
    return next();
  }

  // 2. Admins and bots are fully exempt — same policy as flood-guard & captcha
  const isExempt = await isAutoModerationExempt(ctx, chatId, ctx.from!);
  if (isExempt) {
    return next();
  }

  // 3. Retrieve the media filter config for this group
  const filterConfig = ctx.groupSettings?.mediaFilter;
  if (!filterConfig) {
    return next();
  }

  // 4. Determine matching category (if any).
  //    Multiple categories can technically match at once (e.g. a photo message
  //    that also has a URL in its caption). We detect all matches but punish
  //    only ONCE — the first match wins for the reason string.
  //    Reason strings are resolved through i18n to respect the group's locale.
  let triggeredReason: string | null = null;

  if (filterConfig.photo && msg.photo) {
    triggeredReason = ctx.t("reason_media_photo");
  } else if (filterConfig.video && msg.video) {
    triggeredReason = ctx.t("reason_media_video");
  } else if (filterConfig.sticker && msg.sticker) {
    triggeredReason = ctx.t("reason_media_sticker");
  } else if (filterConfig.gif && msg.animation) {
    triggeredReason = ctx.t("reason_media_gif");
  }

  // Link detection: check both message body entities and caption entities
  if (!triggeredReason && filterConfig.link) {
    const allEntities = [
      ...(msg.entities ?? []),
      ...(msg.caption_entities ?? []),
    ];
    const hasLink = allEntities.some(
      (entity) => entity.type === "url" || entity.type === "text_link",
    );
    if (hasLink) {
      triggeredReason = ctx.t("reason_media_link");
    }
  }

  // 5. No match — pass through
  if (!triggeredReason) {
    return next();
  }

  // 6. Violation — apply shared punishment once
  logger.info(
    { event: "media_filter_triggered", chatId, userId, reason: triggeredReason },
    "Media filter matched — applying restriction punishment",
  );

  await applyRestrictionPunishment(ctx, chatId, userId, triggeredReason, "MEDIAKICK");
  // Stop propagation — message has been handled (deleted + user kicked)
}
