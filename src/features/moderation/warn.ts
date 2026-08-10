import type { BotContext } from "../../types/context.js";
import { getRedisClient } from "../../db/redis.js";
import { warnKey } from "../../db/keys.js";
import { resolveTarget, formatUserMention } from "../../utils/target-resolver.js";
import { notifyTargetAndLog } from "../../utils/notify.js";
import { isGroupAdmin } from "../../middlewares/admin-guard.js";
import { isModerationFeatureEnabled } from "../../utils/permissions.js";
import { banUser } from "./ban.js"; // We will export this helper from ban.ts

/**
 * /warn (or !warn)
 * Structure:
 *   a. Reply: `/warn <reason>`
 *   b. Explicit: `/warn <user_id> <reason>` (or @username)
 */
export async function warnHandler(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const adminId = ctx.from?.id;
  if (!chatId || !adminId) return;

  // 0. Gating check
  if (!isModerationFeatureEnabled(ctx, "warn")) {
    await ctx.reply(ctx.t("error_moderation_disabled", { feature: "warn" }));
    return;
  }

  // 1. Only run in group chats
  if (ctx.chat.type === "private") {
    await ctx.reply(ctx.t("error_group_only"));
    return;
  }

  // 3. Resolve target
  const text = ctx.message?.text ?? ctx.message?.caption ?? "";
  const match = /^\/warn\s*/i.exec(text); // the command parser rewrote it to /warn
  if (!match) return; // Should not happen if routed correctly

  const target = await resolveTarget(ctx, text, match[0].length);
  if (!target) {
    await ctx.reply(ctx.t("usage_warn"));
    return;
  }

  // 4. Check immunity
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

  // 5. Perform action (increment warn count)
  const redis = getRedisClient();
  const key = warnKey(chatId, target.userId);
  const currentCount = await redis.incr(key); // Persistent counter

  const threshold = ctx.groupSettings?.warnThreshold ?? 5;
  const isBanEnabled = isModerationFeatureEnabled(ctx, "ban");

  if (currentCount >= threshold && isBanEnabled) {
    // Escalate to auto-ban
    await banUser(ctx, {
      chatId,
      targetId: target.userId,
      targetUsername: target.username,
      targetDisplayName: target.displayName,
      adminId,
      adminUsername: ctx.from.username,
      adminDisplayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Admin",
      reason: ctx.t("reason_warn_limit_reached"),
      isAutoBan: true,
    });
    // The banUser helper will handle the reply and action card for the ban.
  } else {
    // Standard warn (or threshold reached but ban is disabled)
    const isThresholdHitButBanDisabled = currentCount >= threshold && !isBanEnabled;
    const extraNote = isThresholdHitButBanDisabled ? " (Auto-ban would have triggered but is disabled)" : "";
    const reasonText = (target.reason || ctx.t("no_reason_provided")) + extraNote;

    const adminDisplayName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Admin";

    await notifyTargetAndLog(ctx, {
      chatId,
      userId: target.userId,
      username: target.username,
      displayName: target.displayName,
      adminId,
      adminUsername: ctx.from.username,
      adminDisplayName,
      action: "warn",
      reason: reasonText,
      warnCount: currentCount,
      warnThreshold: threshold,
    });

    const replyText = ctx.t("reply_warned", {
      target: "TARGET_PLACEHOLDER",
      count: currentCount.toString(),
      threshold: threshold.toString(),
      reason: reasonText,
    }).replace("TARGET_PLACEHOLDER", formatUserMention(target.userId, target.displayName, target.username));

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: ctx.t("btn_remove_warn"), callback_data: `rm_warn:${target.userId}` }
        ]
      ]
    };

    await ctx.reply(replyText, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
      link_preview_options: { is_disabled: true },
    });
  }
}

export async function removeWarnHandler(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("rm_warn:")) return;

  const targetId = parseInt(data.split(":")[1] || "0", 10);
  const chatId = ctx.chat?.id;
  const adminId = ctx.from?.id;
  
  if (!chatId || !adminId || !targetId) {
    await ctx.answerCallbackQuery({ text: ctx.t("error_generic"), show_alert: true });
    return;
  }

  // Ensure caller is an admin
  const isAdmin = await isGroupAdmin(ctx, chatId, adminId);
  if (!isAdmin) {
    await ctx.answerCallbackQuery({ text: ctx.t("error_admin_only"), show_alert: true });
    return;
  }

  const redis = getRedisClient();
  const key = warnKey(chatId, targetId);
  const count = await redis.decr(key);
  if (count < 0) {
    await redis.set(key, 0);
  }

  try {
    await ctx.editMessageReplyMarkup();
  } catch (e) {}

  await ctx.answerCallbackQuery(ctx.t("warn_removed"));
}
