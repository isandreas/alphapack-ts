import type { BotContext } from "../types/context.js";
import { postActionCard } from "../middlewares/logger.js";
import { logger } from "./logger.js";
import { formatUserMention } from "./target-resolver.js";
import type { InlineKeyboardMarkup } from "grammy/types";

export interface NotifyOptions {
  chatId: number;
  groupTitle?: string | undefined;
  userId: number;
  username?: string | undefined;
  displayName?: string | undefined;
  adminId: number;
  adminUsername?: string | undefined;
  adminDisplayName?: string | undefined;
  action: "warn" | "mute" | "tban" | "ban" | "unmute" | "unban";
  reason?: string | undefined;
  duration?: string | undefined;
  warnCount?: number | undefined;
  warnThreshold?: number | undefined;
  customMessage?: {
    text: string;
    buttonLabel?: string | undefined;
    buttonUrl?: string | undefined;
  } | undefined;
}

/**
 * Formats a Date into a human-readable local date-time string (YYYY-MM-DD HH:mm:ss).
 */
export function formatDateTime(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Sends a DM to the target user and posts an action card to the log channel.
 * Catches all errors from the DM send so the main handler doesn't crash.
 * Returns true if DM succeeded, false if it failed.
 */
export async function notifyTargetAndLog(
  ctx: BotContext,
  opts: NotifyOptions,
): Promise<boolean> {
  let dmSucceeded = false;

  // 1. Attempt to DM the user
  try {
    let dmText = "";
    let replyMarkup: InlineKeyboardMarkup | undefined = undefined;

    if (opts.customMessage) {
      dmText = opts.customMessage.text;
      if (opts.customMessage.buttonLabel && opts.customMessage.buttonUrl) {
        replyMarkup = {
          inline_keyboard: [
            [
              {
                text: opts.customMessage.buttonLabel,
                url: opts.customMessage.buttonUrl,
              },
            ],
          ],
        };
      }
    } else {
      // Build default i18n message
      const i18nPrefix = `dm_${opts.action}`;
      dmText = ctx.t(i18nPrefix, {
        group: (ctx.chat && "title" in ctx.chat && ctx.chat.title) ? ctx.chat.title : "the group",
        reason: opts.reason || ctx.t("no_reason_provided"),
        duration: opts.duration || "",
        count: opts.warnCount?.toString() || "",
        threshold: opts.warnThreshold?.toString() || "",
      });
    }

    const sendOpts: any = {};
    if (replyMarkup) sendOpts.reply_markup = replyMarkup;
    await ctx.api.sendMessage(opts.userId, dmText, sendOpts);
    dmSucceeded = true;
  } catch (err) {
    logger.debug({ event: "dm_failed", userId: opts.userId, err }, "Failed to DM user");
  }

  // 2. Post action card to log channel
  const dateStr = formatDateTime();

  let groupTitle = opts.groupTitle;
  if (!groupTitle && ctx.chat && "title" in ctx.chat && ctx.chat.title) {
    groupTitle = ctx.chat.title;
  }

  const groupLabel = groupTitle
    ? `${escapeHtml(groupTitle)} [<code>${opts.chatId}</code>]`
    : `<code>${opts.chatId}</code>`;

  const targetLabel = formatUserMention(opts.userId, opts.displayName, opts.username);

  let adminLabel = "System";
  if (opts.adminId) {
    const adminName = opts.adminDisplayName || (opts.adminUsername ? `@${opts.adminUsername}` : "Admin");
    adminLabel = formatUserMention(opts.adminId, adminName, opts.adminUsername);
  }

  const cardLines = [
    `<b>Action:</b> ${opts.action.toUpperCase()}`,
    `<b>Group:</b> ${groupLabel}`,
    `<b>Target:</b> ${targetLabel}`,
    `<b>Admin:</b> ${adminLabel}`,
    `<b>Date:</b> ${dateStr}`,
    opts.reason ? `<b>Reason:</b> ${opts.reason}` : "",
    opts.duration ? `<b>Duration:</b> ${opts.duration}` : "",
    opts.warnCount ? `<b>Warns:</b> ${opts.warnCount}/${opts.warnThreshold}` : "",
    `#${opts.action}`,
  ].filter(Boolean);

  const card = cardLines.join("\n");

  await postActionCard(opts.chatId, card);

  return dmSucceeded;
}
