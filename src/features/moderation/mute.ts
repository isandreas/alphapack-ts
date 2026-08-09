import type { BotContext } from "../../types/context.js";
import { getRedisClient } from "../../db/redis.js";
import { muteKey, schedulerZsetKey } from "../../db/keys.js";
import { resolveTargetWithDuration, resolveTarget, formatUserMention } from "../../utils/target-resolver.js";
import { notifyTargetAndLog } from "../../utils/notify.js";
import { logger } from "../../utils/logger.js";
import { isGroupAdmin } from "../../middlewares/admin-guard.js";
import { untilDate, formatDuration } from "../../utils/time-parser.js";

export interface MuteUserOptions {
  chatId: number;
  targetId: number;
  targetUsername?: string | undefined;
  targetDisplayName?: string | undefined;
  adminId: number;
  adminUsername?: string | undefined;
  adminDisplayName?: string | undefined;
  reason: string;
  durationSeconds: number;
  skipNotifyAndLog?: boolean | undefined;
}

/**
 * Reusable core helper to mute a user, persist their mute status in Redis,
 * register the auto-unmute action with the scheduler, and send a notification/log.
 */
export async function muteUser(ctx: BotContext, opts: MuteUserOptions): Promise<boolean> {
  const until = opts.durationSeconds ? untilDate(opts.durationSeconds) : 0;

  try {
    await ctx.api.restrictChatMember(
      opts.chatId, 
      opts.targetId, 
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
      },
      { until_date: until }
    );
  } catch (err: unknown) {
    logger.error({ err, event: "mute_api_failed", chatId: opts.chatId, targetId: opts.targetId }, "Failed to mute user");
    return false;
  }

  if (opts.durationSeconds) {
    const redis = getRedisClient();
    const mKey = muteKey(opts.chatId, opts.targetId);
    await redis.set(mKey, "1", "EX", opts.durationSeconds);
    
    const payload = JSON.stringify({
      action: "unmute",
      chatId: opts.chatId,
      userId: opts.targetId,
      displayName: opts.targetDisplayName || "User",
      adminId: opts.adminId,
      reason: opts.reason,
    });
    await redis.zadd(schedulerZsetKey(), until, payload);
  }

  if (!opts.skipNotifyAndLog) {
    const durationStr = opts.durationSeconds ? formatDuration(opts.durationSeconds) : undefined;
    await notifyTargetAndLog(ctx, {
      chatId: opts.chatId,
      userId: opts.targetId,
      username: opts.targetUsername,
      displayName: opts.targetDisplayName,
      adminId: opts.adminId,
      adminUsername: opts.adminUsername,
      adminDisplayName: opts.adminDisplayName,
      action: "mute",
      reason: opts.reason,
      duration: durationStr,
    });
  }

  return true;
}

export async function muteHandler(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const adminId = ctx.from?.id;
  if (!chatId || !adminId) return;

  if (ctx.chat.type === "private") {
    await ctx.reply(ctx.t("error_group_only"));
    return;
  }

  const text = ctx.message?.text ?? ctx.message?.caption ?? "";
  const match = /^\/mute\s*/i.exec(text);
  if (!match) return;

  // Mute duration is mandatory like tban
  const target = await resolveTargetWithDuration(ctx, text, match[0].length, true);
  if (!target || !target.durationSeconds) {
    await ctx.reply(ctx.t("usage_mute"));
    return;
  }

  if (target.userId === ctx.me.id) {
    await ctx.reply(ctx.t("error_immune_bot"));
    return;
  }
  if (target.userId === adminId) {
    await ctx.reply(ctx.t("error_immune_self"));
    return;
  }
  const isTargetAdmin = await isGroupAdmin(ctx, chatId, target.userId);
  if (isTargetAdmin) {
    await ctx.reply(ctx.t("error_immune_admin"));
    return;
  }

  const adminDisplayName = ctx.from ? ([ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Admin") : "Admin";

  const success = await muteUser(ctx, {
    chatId,
    targetId: target.userId,
    targetUsername: target.username,
    targetDisplayName: target.displayName,
    adminId,
    adminUsername: ctx.from?.username,
    adminDisplayName,
    reason: target.reason || "",
    durationSeconds: target.durationSeconds,
  });

  if (!success) {
    await ctx.reply(ctx.t("error_mute_failed"));
    return;
  }

  const durationStr = target.durationSeconds ? formatDuration(target.durationSeconds) : undefined;
  const replyText = ctx.t("reply_muted", {
    target: "TARGET_PLACEHOLDER",
    reason: target.reason || ctx.t("no_reason_provided"),
    duration: durationStr || "indefinitely",
  }).replace("TARGET_PLACEHOLDER", formatUserMention(target.userId, target.displayName, target.username));

  await ctx.reply(replyText, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

export async function unmuteHandler(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const adminId = ctx.from?.id;
  if (!chatId || !adminId) return;

  if (ctx.chat.type === "private") {
    await ctx.reply(ctx.t("error_group_only"));
    return;
  }

  const text = ctx.message?.text ?? ctx.message?.caption ?? "";
  const match = /^\/unmute\s*/i.exec(text);
  if (!match) return;

  const target = await resolveTarget(ctx, text, match[0].length);
  if (!target) {
    await ctx.reply(ctx.t("usage_unmute"));
    return;
  }

  try {
    await ctx.api.restrictChatMember(
      chatId, 
      target.userId, 
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
    logger.error({ err, event: "unmute_api_failed", chatId, targetId: target.userId }, "Failed to unmute user");
    await ctx.reply(ctx.t("error_unmute_failed"));
    return;
  }

  const redis = getRedisClient();
  await redis.del(muteKey(chatId, target.userId));

  const adminDisplayName = ctx.from ? ([ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Admin") : "Admin";

  await notifyTargetAndLog(ctx, {
    chatId,
    userId: target.userId,
    username: target.username,
    displayName: target.displayName,
    adminId,
    adminUsername: ctx.from?.username,
    adminDisplayName,
    action: "unmute",
    reason: target.reason,
  });

  const replyText = ctx.t("reply_unmuted", {
    target: "TARGET_PLACEHOLDER",
  }).replace("TARGET_PLACEHOLDER", formatUserMention(target.userId, target.displayName, target.username));

  await ctx.reply(replyText, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}
