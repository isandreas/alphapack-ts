import { Bot, GrammyError } from "grammy";
import type { BotContext } from "../../types/context.js";
import { getRedisClient } from "../../db/redis.js";
import { schedulerZsetKey, muteKey, tbanKey, groupSettingsKey } from "../../db/keys.js";
import { logger } from "../../utils/logger.js";
import { formatUserMention } from "../../utils/target-resolver.js";
import { i18nInstance } from "../../bot.js";
import { env } from "../../config/env.js";

export interface ScheduledAction {
  action: "unmute" | "unban" | "captcha-kick";
  chatId: number;
  userId: number;
  displayName?: string | undefined;
  adminId: number;     // Original admin who issued the action (0 for System)
  reason?: string;      // Original reason
  messageId?: number | undefined; // Message ID of captcha challenge to delete
}

/**
 * Starts a periodic polling loop to process scheduled actions (unmute, unban, captcha-kick).
 * Runs every 30 seconds.
 */
export function startScheduler(bot: Bot<BotContext>): NodeJS.Timeout {
  return setInterval(() => {
    processScheduledActions(bot).catch((err) => {
      logger.error({ err, event: "scheduler_error" }, "Error in scheduled action poller");
    });
  }, 30_000);
}

async function processScheduledActions(bot: Bot<BotContext>): Promise<void> {
  const redis = getRedisClient();
  const key = schedulerZsetKey();
  const now = Math.floor(Date.now() / 1_000);

  // Fetch all items with a score <= now
  const items = await redis.zrangebyscore(key, "-inf", now);
  if (items.length === 0) return;

  for (const itemStr of items) {
    try {
      const item = JSON.parse(itemStr) as ScheduledAction;
      await executeAction(bot, item);
      
      // Remove it from the set after successful execution
      await redis.zrem(key, itemStr);
    } catch (err) {
      logger.error({ err, event: "scheduler_item_error", itemStr }, "Failed to process scheduled item");
      if (err instanceof SyntaxError || (err instanceof GrammyError && err.error_code >= 400 && err.error_code < 500)) {
        await redis.zrem(key, itemStr);
      }
    }
  }
}

async function executeAction(bot: Bot<BotContext>, item: ScheduledAction): Promise<void> {
  logger.info({ event: "scheduler_execute", ...item }, `Executing scheduled ${item.action}`);
  const redis = getRedisClient();
  
  try {
    if (item.action === "unban") {
      await bot.api.unbanChatMember(item.chatId, item.userId, { only_if_banned: true });
      await redis.del(tbanKey(item.chatId, item.userId));
    } else if (item.action === "unmute") {
      await bot.api.restrictChatMember(
        item.chatId, 
        item.userId, 
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
      await redis.del(muteKey(item.chatId, item.userId));
    } else if (item.action === "captcha-kick") {
      // Set short-lived goodbye bypass key
      const { kickBypassGoodbyeKey } = await import("../../db/keys.js");
      await redis.set(kickBypassGoodbyeKey(item.chatId, item.userId), "1", "EX", 10);

      // Kick user (ban followed immediately by unban)
      await bot.api.banChatMember(item.chatId, item.userId);
      await bot.api.unbanChatMember(item.chatId, item.userId);

      // Delete the stale challenge message
      if (item.messageId) {
        try {
          await bot.api.deleteMessage(item.chatId, item.messageId);
        } catch (e) {}
      }

      // Fetch group configuration for timeout settings
      const { getGroupSettings } = await import("../../middlewares/group-settings.js");
      const settings = await getGroupSettings(item.chatId);
      const timeoutSeconds = settings.welcome.captcha.timeoutSeconds;

      // Try to get chat title
      let groupTitle = "Group";
      try {
        const chat = await bot.api.getChat(item.chatId);
        if ("title" in chat && chat.title) {
          groupTitle = chat.title;
        }
      } catch (e) {}

      const targetLabel = formatUserMention(item.userId, item.displayName || "User");
      const dateStr = new Date().toISOString().replace("T", " ").substring(0, 19);

      const cardLines = [
        `<b>Action:</b> CAPTCHAKICK`,
        `<b>Group:</b> ${groupTitle} [<code>${item.chatId}</code>]`,
        `<b>Target:</b> ${targetLabel}`,
        `<b>Admin:</b> System (Auto-Moderation)`,
        `<b>Date:</b> ${dateStr}`,
        `<b>Reason:</b> captcha not completed within ${timeoutSeconds}s`,
        `#captchakick`,
      ];

      const { postActionCard } = await import("../../middlewares/logger.js");
      await postActionCard(item.chatId, cardLines.join("\n"));
    }
  } catch (err: unknown) {
    if (err instanceof GrammyError && err.error_code === 400) {
      logger.debug({ event: "scheduler_target_missing", ...item }, "Could not execute action, target missing/invalid");
    } else {
      throw err;
    }
  }

  // Captcha-kick has completed all actions (logging, deletion, and kicking). No further notifications required.
  if (item.action === "captcha-kick") {
    return;
  }

  try {
    const locale = (await redis.hget(groupSettingsKey(item.chatId), "locale")) || env.DEFAULT_LOCALE;

    if (item.action === "unban") {
      let inviteLink: string | undefined;
      try {
        inviteLink = await bot.api.exportChatInviteLink(item.chatId);
      } catch (e) {
        logger.debug({ err: e, event: "export_invite_failed" }, "Could not export invite link");
      }

      let groupTitle = "the group";
      try {
        const chat = await bot.api.getChat(item.chatId);
        if ("title" in chat && chat.title) {
          groupTitle = chat.title;
        }
      } catch (e) {}

      const text = i18nInstance.t(locale, "dm_tban_expired", { group: groupTitle });
      const buttonLabel = i18nInstance.t(locale, "rejoin_group_btn");

      let replyMarkup: any = undefined;
      if (inviteLink) {
        replyMarkup = {
          inline_keyboard: [[{ text: buttonLabel, url: inviteLink }]]
        };
      }

      await bot.api.sendMessage(item.userId, text, { reply_markup: replyMarkup });

      const notifyText = i18nInstance.t(locale, "group_tban_expired", {
        target: "TARGET_PLACEHOLDER"
      }).replace("TARGET_PLACEHOLDER", formatUserMention(item.userId, item.displayName));
      await bot.api.sendMessage(item.chatId, notifyText, { parse_mode: "HTML" });

    } else {
      let groupTitle = "the group";
      try {
        const chat = await bot.api.getChat(item.chatId);
        if ("title" in chat && chat.title) {
          groupTitle = chat.title;
        }
      } catch (e) {}

      const text = i18nInstance.t(locale, "dm_unmute_expired", { group: groupTitle });
      await bot.api.sendMessage(item.userId, text);
    }
  } catch (err: unknown) {
    logger.error({ err, event: "scheduler_notify_failed" }, "Failed to notify user of expired action");
  }
}
