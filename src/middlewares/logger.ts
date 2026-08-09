/**
 * middlewares/logger.ts
 *
 * Request-level audit logger middleware.
 * Logs every processed update as a structured JSON entry (pino → PM2).
 *
 * Also provides postActionCard() — a standalone helper that posts
 * HTML-formatted action cards to a group's configured log channel.
 * It resolves logChannelId via getGroupSettings() internally,
 * so callers don't need a BotContext.
 */

import type { NextFunction, Api } from "grammy";
import type { BotContext } from "../types/context.js";
import { logger } from "../utils/logger.js";
import { getGroupSettings } from "./group-settings.js";

// ── Bot API reference ─────────────────────────────────────────────────────────
// Stored once during createBot() so postActionCard can work without ctx.

let _api: Api | null = null;

/**
 * Registers the bot's Api instance for standalone use by postActionCard.
 * Called once during bot initialization in createBot().
 */
export function registerBotApi(api: Api): void {
  _api = api;
}

// ── Audit Logger Middleware ───────────────────────────────────────────────────

export async function auditLoggerMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const start = Date.now();

  await next();

  // Determine the update type from the update object's keys
  // (grammY doesn't expose ctx.updateType in all builds)
  const updateType =
    Object.keys(ctx.update).find((k) => k !== "update_id") ?? "unknown";

  logger.debug({
    event: "update_processed",
    update_id: ctx.update.update_id,
    update_type: updateType,
    chat_id: ctx.chat?.id,
    chat_type: ctx.chat?.type,
    user_id: ctx.from?.id,
    username: ctx.from?.username,
    duration_ms: Date.now() - start,
  });
}

// ── Action Card Poster ────────────────────────────────────────────────────────

/**
 * Posts an HTML-formatted action card to the group's audit log channel.
 *
 * Standalone: resolves logChannelId from getGroupSettings(chatId) internally.
 * If no log channel is configured, returns silently (no error).
 * Uses the stored bot API reference (registered via registerBotApi).
 *
 * @param chatId Source group chat ID (used to look up logChannelId)
 * @param card   HTML-formatted action card text
 */
import type { InlineKeyboardMarkup } from "grammy/types";

export async function postActionCard(
  chatId: number,
  card: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  if (!_api) {
    logger.debug(
      { event: "log_channel_no_api", chatId },
      "postActionCard called before bot API was registered — skipping",
    );
    return;
  }

  let logChannelId: number | null = null;
  try {
    const settings = await getGroupSettings(chatId);
    logChannelId = settings.logChannelId;
  } catch (err: unknown) {
    logger.warn(
      { event: "log_channel_settings_error", chatId, err },
      "Failed to load group settings for log channel — skipping",
    );
    return;
  }

  if (!logChannelId) return;

  const sendOpts: any = {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
  if (replyMarkup) {
    sendOpts.reply_markup = replyMarkup;
  }

  try {
    await _api.sendMessage(logChannelId, card, sendOpts);
  } catch (err: unknown) {
    logger.warn(
      { event: "log_channel_post_failed", chatId, logChannelId, err },
      "Failed to post action card to log channel",
    );
  }
}
