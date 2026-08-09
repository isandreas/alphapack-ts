import type { BotContext } from "../../types/context.js";
import { getRedisClient } from "../../db/redis.js";
import { schedulerZsetKey } from "../../db/keys.js";
import { logger } from "../../utils/logger.js";

/**
 * Helper to remove pending captcha-kick entries from the scheduler ZSET.
 */
async function removePendingCaptchaKick(chatId: number, userId: number): Promise<void> {
  const redis = getRedisClient();
  const key = schedulerZsetKey();
  try {
    const items = await redis.zrange(key, "0", "-1");
    for (const itemStr of items) {
      try {
        const item = JSON.parse(itemStr);
        if (
          item.action === "captcha-kick" &&
          item.chatId === chatId &&
          item.userId === userId
        ) {
          await redis.zrem(key, itemStr);
          logger.debug({ event: "captcha_removed_from_scheduler", chatId, userId }, "Removed pending captcha kick from Redis scheduler");
          break;
        }
      } catch (e) {
        // ignore parse error of unrelated scheduler entries
      }
    }
  } catch (err: unknown) {
    logger.error({ err, event: "captcha_scheduler_removal_error", chatId, userId }, "Failed to remove captcha kick from scheduler");
  }
}

/**
 * Handles clicks on the "✅ I'm not a robot" captcha button.
 */
export async function captchaCallbackHandler(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("captcha_approve:")) return;

  const targetUserId = parseInt(data.split(":")[1] || "0", 10);
  const clickerId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!chatId || !clickerId || !targetUserId) {
    await ctx.answerCallbackQuery({ text: "❌ An error occurred.", show_alert: true });
    return;
  }

  // 1. Verify clicker is the target user
  if (clickerId !== targetUserId) {
    await ctx.answerCallbackQuery({
      text: "⚠️ This verification button is not for you.",
      show_alert: true,
    });
    return;
  }

  // 2. Lift restriction
  try {
    await ctx.api.restrictChatMember(
      chatId,
      targetUserId,
      {
        can_send_messages: true,
        can_send_audios: true,
        can_send_documents: true,
        can_send_photos: true,
        can_send_videos: true,
        can_send_video_notes: true,
        can_send_voice_notes: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false,
        can_manage_topics: false,
      }
    );
  } catch (err: unknown) {
    logger.error({ err, event: "captcha_unrestrict_failed", chatId, targetId: targetUserId }, "Failed to unrestrict user on successful captcha");
    await ctx.answerCallbackQuery({ text: "❌ Failed to unrestrict. Please contact an admin.", show_alert: true });
    return;
  }

  // 3. Remove the scheduled captcha timeout kick
  await removePendingCaptchaKick(chatId, targetUserId);

  // 4. Update the challenge message to success state
  try {
    await ctx.editMessageText("✅ Verification successful! Welcome to the group.");
  } catch (err: unknown) {
    logger.warn({ err, event: "captcha_message_edit_failed", chatId, targetId: targetUserId }, "Failed to edit captcha message to success state");
  }

  await ctx.answerCallbackQuery({ text: "✅ Verification successful!" });
}
