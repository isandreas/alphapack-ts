import type { BotContext } from "../../types/context.js";
import { getRedisClient } from "../../db/redis.js";
import { tbanKey, schedulerZsetKey } from "../../db/keys.js";
import { resolveTarget, resolveTargetWithDuration, formatUserMention } from "../../utils/target-resolver.js";
import { notifyTargetAndLog } from "../../utils/notify.js";
import { logger } from "../../utils/logger.js";
import { isGroupAdmin } from "../../middlewares/admin-guard.js";
import { untilDate, formatDuration } from "../../utils/time-parser.js";
import { isModerationFeatureEnabled } from "../../utils/permissions.js";

export interface BanOptions {
  chatId: number;
  targetId: number;
  targetUsername?: string | undefined;
  targetDisplayName?: string | undefined;
  adminId: number;
  adminUsername?: string | undefined;
  adminDisplayName?: string | undefined;
  reason: string;
  durationSeconds?: number | undefined;
  isAutoBan?: boolean | undefined; 
}

/**
 * Core ban execution logic.
 * Used by /ban, /tban, and auto-bans from /warn.
 */
export async function banUser(ctx: BotContext, opts: BanOptions): Promise<void> {
  const until = opts.durationSeconds ? untilDate(opts.durationSeconds) : 0;
  
  try {
    const { kickBypassGoodbyeKey } = await import("../../db/keys.js");
    const redis = getRedisClient();
    await redis.set(kickBypassGoodbyeKey(opts.chatId, opts.targetId), "1", "EX", 10);

    await ctx.api.banChatMember(opts.chatId, opts.targetId, {
      until_date: until,
    });
  } catch (err: unknown) {
    logger.error({ err, event: "ban_api_failed", ...opts }, "Failed to ban user");
    await ctx.reply(ctx.t("error_ban_failed"));
    return;
  }

  const action = opts.durationSeconds ? "tban" : "ban";
  const durationStr = opts.durationSeconds ? formatDuration(opts.durationSeconds) : undefined;
  
  // Track in Redis for our scheduler if it's a tban
  if (opts.durationSeconds) {
    const redis = getRedisClient();
    const tbKey = tbanKey(opts.chatId, opts.targetId);
    
    // Set a key for the ban itself (just for tracking/debugging)
    await redis.set(tbKey, "1", "EX", opts.durationSeconds);
    
    // Add to the global scheduler ZSET
    const payload = JSON.stringify({
      action: "unban",
      chatId: opts.chatId,
      userId: opts.targetId,
      displayName: opts.targetDisplayName,
      adminId: opts.adminId,
      reason: opts.reason,
    });
    await redis.zadd(schedulerZsetKey(), until, payload);
  }

  await notifyTargetAndLog(ctx, {
    chatId: opts.chatId,
    userId: opts.targetId,
    username: opts.targetUsername,
    displayName: opts.targetDisplayName,
    adminId: opts.adminId,
    adminUsername: opts.adminUsername,
    adminDisplayName: opts.adminDisplayName,
    action,
    reason: opts.reason,
    duration: durationStr,
  });

  const i18nKey = action === "tban" ? "reply_tbanned" : "reply_banned";
  const replyText = ctx.t(i18nKey, {
    target: "TARGET_PLACEHOLDER",
    reason: opts.reason || ctx.t("no_reason_provided"),
    duration: durationStr || "",
  }).replace("TARGET_PLACEHOLDER", formatUserMention(opts.targetId, opts.targetDisplayName, opts.targetUsername));

  await ctx.reply(replyText, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

export async function banHandler(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const adminId = ctx.from?.id;
  if (!chatId || !adminId) return;

  // 0. Gating check
  if (!isModerationFeatureEnabled(ctx, "ban")) {
    await ctx.reply(ctx.t("error_moderation_disabled", { feature: "ban" }));
    return;
  }

  if (ctx.chat.type === "private") {
    await ctx.reply(ctx.t("error_group_only"));
    return;
  }

  const text = ctx.message?.text ?? ctx.message?.caption ?? "";
  const match = /^\/ban\s*/i.exec(text);
  if (!match) return;

  const target = await resolveTarget(ctx, text, match[0].length);
  if (!target) {
    await ctx.reply(ctx.t("usage_ban"));
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

  await banUser(ctx, {
    chatId,
    targetId: target.userId,
    targetUsername: target.username,
    targetDisplayName: target.displayName,
    adminId,
    adminUsername: ctx.from?.username,
    adminDisplayName,
    reason: target.reason,
  });
}

export async function tbanHandler(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const adminId = ctx.from?.id;
  if (!chatId || !adminId) return;

  // 0. Gating check
  if (!isModerationFeatureEnabled(ctx, "tban")) {
    await ctx.reply(ctx.t("error_moderation_disabled", { feature: "tban" }));
    return;
  }

  if (ctx.chat.type === "private") {
    await ctx.reply(ctx.t("error_group_only"));
    return;
  }

  const text = ctx.message?.text ?? ctx.message?.caption ?? "";
  const match = /^\/tban\s*/i.exec(text);
  if (!match) return;

  // Require duration
  const target = await resolveTargetWithDuration(ctx, text, match[0].length, true);
  if (!target || !target.durationSeconds) {
    await ctx.reply(ctx.t("usage_tban"));
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

  await banUser(ctx, {
    chatId,
    targetId: target.userId,
    targetUsername: target.username,
    targetDisplayName: target.displayName,
    adminId,
    adminUsername: ctx.from?.username,
    adminDisplayName,
    reason: target.reason,
    durationSeconds: target.durationSeconds,
  });
}

export async function unbanHandler(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const adminId = ctx.from?.id;
  if (!chatId || !adminId) return;

  // 0. Gating check
  if (!isModerationFeatureEnabled(ctx, "ban")) {
    await ctx.reply(ctx.t("error_moderation_disabled", { feature: "ban" }));
    return;
  }

  if (ctx.chat.type === "private") {
    await ctx.reply(ctx.t("error_group_only"));
    return;
  }

  const text = ctx.message?.text ?? ctx.message?.caption ?? "";
  const match = /^\/unban\s*/i.exec(text);
  if (!match) return;

  const target = await resolveTarget(ctx, text, match[0].length);
  if (!target) {
    await ctx.reply(ctx.t("usage_unban"));
    return;
  }

  try {
    await ctx.api.unbanChatMember(chatId, target.userId, { only_if_banned: true });
  } catch (err: unknown) {
    logger.error({ err, event: "unban_api_failed", chatId, targetId: target.userId }, "Failed to unban user");
    await ctx.reply(ctx.t("error_unban_failed"));
    return;
  }

  // Cleanup Redis
  const redis = getRedisClient();
  await redis.del(tbanKey(chatId, target.userId));

  // Warn counter check and reset if threshold reached
  const { warnKey } = await import("../../db/keys.js");
  const warnKeyVal = warnKey(chatId, target.userId);
  const currentWarns = parseInt((await redis.get(warnKeyVal)) || "0", 10);
  const threshold = ctx.groupSettings?.warnThreshold ?? 5;
  const isReset = currentWarns >= threshold;
  if (isReset) {
    await redis.del(warnKeyVal);
  }

  let inviteLink: string | undefined;
  try {
    inviteLink = await ctx.api.exportChatInviteLink(chatId);
  } catch (e) {
    logger.debug({ err: e, event: "export_invite_failed" }, "Could not export invite link for unban");
  }

  let customMessage: any = undefined;
  if (inviteLink) {
    let groupTitle = "the group";
    if (ctx.chat && "title" in ctx.chat && ctx.chat.title) {
      groupTitle = ctx.chat.title;
    }
    customMessage = {
      text: ctx.t("dm_unban", { group: groupTitle }),
      buttonLabel: ctx.t("rejoin_group_btn"),
      buttonUrl: inviteLink
    };
  }

  const adminDisplayName = ctx.from ? ([ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Admin") : "Admin";

  await notifyTargetAndLog(ctx, {
    chatId,
    userId: target.userId,
    username: target.username,
    displayName: target.displayName,
    adminId,
    adminUsername: ctx.from?.username,
    adminDisplayName,
    action: "unban",
    reason: target.reason,
    customMessage,
  });

  const translationKey = isReset ? "reply_unbanned_reset" : "reply_unbanned";
  const replyText = ctx.t(translationKey, {
    target: "TARGET_PLACEHOLDER",
  }).replace("TARGET_PLACEHOLDER", formatUserMention(target.userId, target.displayName, target.username));

  await ctx.reply(replyText, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}
