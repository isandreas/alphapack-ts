import type { NextFunction } from "grammy";
import type { BotContext } from "../../types/context.js";
import type { GroupSettings } from "../../types/settings.js";
import { getRedisClient } from "../../db/redis.js";
import { floodKey } from "../../db/keys.js";
import { isAutoModerationExempt } from "../../utils/permissions.js";
import { muteUser } from "../moderation/mute.js";
import { postActionCard } from "../../middlewares/logger.js";
import { formatUserMention } from "../../utils/target-resolver.js";
import { formatDuration } from "../../utils/time-parser.js";
import { logger } from "../../utils/logger.js";

/**
 * Apply the configured flood punishment to a user.
 * Currently only 'mute' punishment type is implemented.
 */
export async function applyFloodPunishment(
  ctx: BotContext,
  chatId: number,
  userId: number,
  config: NonNullable<GroupSettings["floodGuard"]>,
): Promise<void> {
  const punishmentType = config.punishment.type;

  switch (punishmentType) {
    case "mute": {
      const durationSeconds = config.punishment.durationSeconds;
      const durationStr = formatDuration(durationSeconds);
      const reason = `message rate exceeded ${config.messageThreshold} in ${config.windowSeconds}s`;

      const targetDisplayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "User";

      // 1. Perform core mute via the shared muteUser helper
      const success = await muteUser(ctx, {
        chatId,
        targetId: userId,
        targetUsername: ctx.from?.username ?? undefined,
        targetDisplayName,
        adminId: 0, // System
        adminDisplayName: "System (Auto-Moderation)",
        reason,
        durationSeconds,
        skipNotifyAndLog: true, // We handle custom logging/DM notifications below
      });

      if (!success) {
        logger.error({ event: "flood_mute_failed", chatId, userId }, "Failed to apply auto-mute flood punishment");
        return;
      }

      // Send group chat notification about the auto-mute
      const replyText = ctx.t("reply_flood_muted", {
        target: "TARGET_PLACEHOLDER",
        duration: durationStr,
      }).replace("TARGET_PLACEHOLDER", formatUserMention(userId, targetDisplayName, ctx.from?.username ?? undefined));

      try {
        await ctx.reply(replyText, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
      } catch (err: unknown) {
        logger.warn({ event: "flood_reply_failed", chatId, userId, err }, "Failed to send group reply for flood mute");
      }

      // 2. Clear/reset user's flood counter from Redis so they aren't instantly re-muted
      const redis = getRedisClient();
      const fKey = floodKey(chatId, userId);
      await redis.del(fKey);

      // 3. Construct and post a #FLOODMUTE action card to the log channel
      const targetLabel = formatUserMention(userId, targetDisplayName, ctx.from?.username ?? undefined);
      const dateStr = new Date().toISOString().replace("T", " ").substring(0, 19);

      const cardLines = [
        `<b>Action:</b> FLOODMUTE`,
        `<b>Group:</b> ${ctx.chat?.title || "Group"} [<code>${chatId}</code>]`,
        `<b>Target:</b> ${targetLabel}`,
        `<b>Admin:</b> System (Auto-Moderation)`,
        `<b>Date:</b> ${dateStr}`,
        `<b>Reason:</b> ${reason}`,
        `<b>Duration:</b> ${durationStr}`,
        `#floodmute`,
      ];

      // Build "Go to message" button if chat and message context is available
      let messageUrl: string | undefined = undefined;
      if (ctx.chat && ctx.message) {
        if (ctx.chat.username) {
          messageUrl = `https://t.me/${ctx.chat.username}/${ctx.message.message_id}`;
        } else {
          const absId = Math.abs(ctx.chat.id).toString();
          const cleanId = absId.startsWith("100") ? absId.slice(3) : absId;
          messageUrl = `https://t.me/c/${cleanId}/${ctx.message.message_id}`;
        }
      }

      const replyMarkup = messageUrl
        ? {
            inline_keyboard: [
              [
                { text: "Go to message", url: messageUrl },
              ],
            ],
          }
        : undefined;

      await postActionCard(chatId, cardLines.join("\n"), replyMarkup);

      // 4. Optionally DM the user a brief notice
      try {
        const groupTitle = ctx.chat?.title || "the group";
        const dmText = ctx.t("dm_flood_mute", {
          group: groupTitle,
          duration: durationStr,
        });
        await ctx.api.sendMessage(userId, dmText);
      } catch (err: unknown) {
        logger.debug({ event: "flood_dm_failed", userId, err }, "Failed to send flood notice DM to user");
      }
      break;
    }
    default: {
      logger.warn(
        { event: "flood_punishment_unknown", type: punishmentType, chatId, userId },
        "Unknown or unimplemented punishment type",
      );
    }
  }
}

/**
 * Flood Guard Middleware — Phase 2
 * Protects groups against message flooding by monitoring per-user message rates.
 */
export async function floodGuardMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;

  // 1. Only run in group/supergroup chats
  if (!chatId || !userId || ctx.chat.type === "private") {
    return await next();
  }

  // 2. Check group flood config
  const config = ctx.groupSettings?.floodGuard;
  if (!config || !config.enabled) {
    return await next();
  }

  // 3. Skip system updates and non-text/media updates
  const isMessage = ctx.message;
  if (!isMessage) {
    return await next();
  }

  // Exclude system service messages
  if (
    isMessage.new_chat_members ||
    isMessage.left_chat_member ||
    isMessage.pinned_message ||
    isMessage.group_chat_created ||
    isMessage.supergroup_chat_created
  ) {
    return await next();
  }

  // 4. Skip auto-moderation exempt members (bots and administrators)
  const isExempt = await isAutoModerationExempt(ctx, chatId, ctx.from);
  if (isExempt) {
    return await next();
  }

  // 5. Track message rate using Redis ZSET (sliding window)
  const redis = getRedisClient();
  const fKey = floodKey(chatId, userId);
  const now = Date.now();
  const minScore = now - config.windowSeconds * 1000;

  try {
    // Remove messages outside the sliding window
    await redis.zremrangebyscore(fKey, "-inf", minScore);
    // Add current message with timestamp as score and message_id as member
    await redis.zadd(fKey, now, String(isMessage.message_id));
    // Set a TTL on the key to automatically clean up inactive sets
    await redis.expire(fKey, config.windowSeconds * 2);

    // Get count of messages in the current window
    const count = await redis.zcard(fKey);

    if (count >= config.messageThreshold) {
      await applyFloodPunishment(ctx, chatId, userId, config);
      // Stop execution propagation for the message that triggered punishment
      return;
    }
  } catch (err: unknown) {
    logger.error({ event: "flood_guard_redis_error", chatId, userId, err }, "Error executing flood guard tracking");
  }

  await next();
}
