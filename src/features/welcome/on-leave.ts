import type { BotContext } from "../../types/context.js";
import { getRedisClient } from "../../db/redis.js";
import { kickBypassGoodbyeKey } from "../../db/keys.js";
import { logger } from "../../utils/logger.js";
import { replacePlaceholders } from "../../utils/placeholder.js";

/**
 * Handles member leave events.
 */
export async function onLeaveHandler(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const member = ctx.message?.left_chat_member;
  if (!chatId || !member) return;

  const settings = ctx.groupSettings;
  if (!settings || !settings.goodbye.enabled) return;

  // 1. Skip if the leave was bot-initiated (kick/ban bypass key exists)
  const redis = getRedisClient();
  const bypassKey = kickBypassGoodbyeKey(chatId, member.id);
  const isBypassed = await redis.get(bypassKey);
  if (isBypassed) {
    logger.debug(
      { event: "leave_bypassed", chatId, userId: member.id },
      "Member left because of admin/system kick/ban — suppressing goodbye message",
    );
    await redis.del(bypassKey);
    return;
  }

  // 2. Format and send goodbye message
  const groupName = (ctx.chat && "title" in ctx.chat ? ctx.chat.title : "Group") || "Group";
  const botName = process.env.BOT_CUSTOM_NAME || ctx.me.first_name;
  const text = replacePlaceholders(settings.goodbye.template, {
    user: member,
    groupName,
    botName,
  });

  try {
    await ctx.reply(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (err: unknown) {
    logger.error({ err, event: "goodbye_send_failed", chatId, targetId: member.id }, "Failed to send goodbye message");
  }
}
