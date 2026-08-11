import type { BotContext } from "../../types/context.js";
import { getRedisClient } from "../../db/redis.js";
import { schedulerZsetKey } from "../../db/keys.js";
import { isAutoModerationExempt } from "../../utils/permissions.js";
import { logger } from "../../utils/logger.js";
import { replacePlaceholders } from "../../utils/placeholder.js";

/**
 * Handles the new_chat_members update.
 */
export async function onJoinHandler(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const newMembers = ctx.message?.new_chat_members;
  if (!chatId || !newMembers || newMembers.length === 0) return;

  const settings = ctx.groupSettings;
  if (!settings) return;

  const groupName = (ctx.chat && "title" in ctx.chat ? ctx.chat.title : "Group") || "Group";
  const botName = process.env.BOT_CUSTOM_NAME || ctx.me.first_name;
  const redis = getRedisClient();

  for (const member of newMembers) {
    // 0. Exempt check (bots and admins are exempt from auto-moderation)
    const isExempt = await isAutoModerationExempt(ctx, chatId, member);
    if (isExempt) {
      logger.debug(
        { event: "join_exempt", chatId, userId: member.id, isBot: member.is_bot },
        "User is exempt from auto-moderation — skipping welcome/captcha",
      );
      continue;
    }

    const captchaEnabled = settings.welcome.captcha.enabled;
    const welcomeEnabled = settings.welcome.enabled;

    if (captchaEnabled) {
      // 1a. Restrict the user immediately
      try {
        await ctx.api.restrictChatMember(
          chatId,
          member.id,
          {
            can_send_messages: false,
            can_send_audios: false,
            can_send_documents: false,
            can_send_photos: false,
            can_send_videos: false,
            can_send_video_notes: false,
            can_send_voice_notes: false,
            can_send_polls: false,
            can_send_other_messages: false,
            can_add_web_page_previews: false,
            can_change_info: false,
            can_invite_users: false,
            can_pin_messages: false,
            can_manage_topics: false,
          }
        );
      } catch (err: unknown) {
        logger.error({ err, event: "captcha_restrict_failed", chatId, targetId: member.id }, "Failed to restrict joining user for captcha");
        // Proceed anyway so we still show challenge and schedule kick
      }

      // 1b. Build challenge message
      const targetLabel = `<a href="tg://user?id=${member.id}">${member.first_name}</a>`;
      const msgText = `⚠️ ${targetLabel}, click the button below to verify you are not a robot and unmute yourself.`;

      const replyMarkup = {
        inline_keyboard: [
          [
            { text: "✅ I'm not a robot", callback_data: `captcha_approve:${member.id}` }
          ]
        ]
      };

      let sentMsg;
      try {
        sentMsg = await ctx.reply(msgText, {
          parse_mode: "HTML",
          reply_markup: replyMarkup,
          link_preview_options: { is_disabled: true },
        });
      } catch (err: unknown) {
        logger.error({ err, event: "captcha_challenge_send_failed", chatId, targetId: member.id }, "Failed to send captcha challenge message");
        continue;
      }

      // 1c. Schedule captcha-kick timeout
      const until = Math.floor(Date.now() / 1000) + settings.welcome.captcha.timeoutSeconds;
      const payload = JSON.stringify({
        action: "captcha-kick",
        chatId,
        userId: member.id,
        displayName: member.first_name,
        adminId: 0,
        messageId: sentMsg.message_id,
      });

      await redis.zadd(schedulerZsetKey(), until, payload);
      logger.debug({ event: "captcha_scheduled", chatId, userId: member.id, until }, "Scheduled captcha timeout");

    } else if (welcomeEnabled) {
      // 2. Captcha disabled but welcome enabled
      const welcomeText = replacePlaceholders(settings.welcome.template, {
        user: member,
        groupName,
        botName,
      });
      try {
        await ctx.reply(welcomeText, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
      } catch (err: unknown) {
        logger.error({ err, event: "welcome_send_failed", chatId, targetId: member.id }, "Failed to send welcome message");
      }
    }
  }
}
