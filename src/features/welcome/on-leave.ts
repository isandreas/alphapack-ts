import type { BotContext } from "../../types/context.js";
import { getRedisClient } from "../../db/redis.js";
import { kickBypassGoodbyeKey } from "../../db/keys.js";
import { logger } from "../../utils/logger.js";

/**
 * Replaces placeholders in the template: {username}, {first_name}, {mention}, {group_name}.
 */
function replacePlaceholders(
  template: string,
  user: { id: number; first_name: string; username?: string | undefined },
  groupName: string,
): string {
  const escapeHtml = (str: string) =>
    str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const safeFirstName = escapeHtml(user.first_name);
  const safeGroupName = escapeHtml(groupName);

  const usernameVal = user.username
    ? `@${escapeHtml(user.username)}`
    : safeFirstName;

  const mentionVal = `<a href="tg://user?id=${user.id}">${safeFirstName}</a>`;

  return template
    .replace(/{first_name}/g, safeFirstName)
    .replace(/{group_name}/g, safeGroupName)
    .replace(/{username}/g, usernameVal)
    .replace(/{mention}/g, mentionVal);
}

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
  const text = replacePlaceholders(settings.goodbye.template, member, groupName);

  try {
    await ctx.reply(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (err: unknown) {
    logger.error({ err, event: "goodbye_send_failed", chatId, targetId: member.id }, "Failed to send goodbye message");
  }
}
