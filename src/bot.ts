/**
 * bot.ts
 *
 * Bot instantiation and middleware wiring.
 *
 * Middleware order (matters):
 *   0. session          — must come before i18n so locale can read from session
 *   1. i18n             — must come before handlers that call ctx.t()
 *   2. commandParser    — must come before grammY routing so "!" is rewritten to "/"
 *   3. groupSettings    — loads ctx.groupSettings for group/supergroup updates
 *   4. auditLogger      — wraps the rest, so timing includes handler execution
 *   5. antiSpam         — Phase 0 stub; slot reserved for Phase 2
 *   6. usernameTracker  — Phase 1: tracks @username → user_id
 *   7. groupRegistry    — tracks which groups the bot is in
 *   8. conversations    — @grammyjs/conversations for multi-step flows
 */

import { Bot, GrammyError, HttpError, session } from "grammy";
import { I18n } from "@grammyjs/i18n";
import { RedisAdapter } from "@grammyjs/storage-redis";
import { sequentialize } from "@grammyjs/runner";
import { conversations, createConversation } from "@grammyjs/conversations";
import { resolve } from "path";

import type { BotContext, SessionData } from "./types/context.js";
import { env } from "./config/env.js";
import { getRedisClient } from "./db/redis.js";
import { sessionKey } from "./db/keys.js";
import { logger } from "./utils/logger.js";

import { commandParserMiddleware } from "./middlewares/command-parser.js";
import { groupSettingsMiddleware } from "./middlewares/group-settings.js";
import { auditLoggerMiddleware, registerBotApi } from "./middlewares/logger.js";
import { limit } from "@grammyjs/ratelimiter";
import { floodGuardMiddleware } from "./features/anti-spam/flood-guard.js";
import { usernameTrackerMiddleware } from "./middlewares/username-tracker.js";
import { requireAdmin } from "./middlewares/admin-guard.js";
import { groupRegistryMiddleware, myChatMemberHandler } from "./features/settings/group-registry.js";
import { setLogChannelCommand, setLogChannelConversation } from "./features/settings/set-log-channel.js";

import { warnHandler, removeWarnHandler } from "./features/moderation/warn.js";
import { muteHandler, unmuteHandler } from "./features/moderation/mute.js";
import { banHandler, tbanHandler, unbanHandler } from "./features/moderation/ban.js";

import { onJoinHandler } from "./features/welcome/on-join.js";
import { onLeaveHandler } from "./features/welcome/on-leave.js";
import { captchaCallbackHandler } from "./features/welcome/captcha-callback.js";
import {
  welcomeToggleCommand,
  setWelcomeCommand,
  goodbyeToggleCommand,
  setGoodbyeCommand,
  captchaToggleCommand,
} from "./features/settings/welcome-settings.js";

import { userRegistryMiddleware } from "./features/mentions/user-registry.js";
import {
  mentionHandlersMiddleware,
  resolveReportCallbackHandler,
} from "./features/mentions/mention-handlers.js";
import {
  adminMentionToggleCommand,
  mentionNotifyToggleCommand,
} from "./features/mentions/mention-settings.js";

import { rulesCommandHandler } from "./features/settings/rules.js";
import { guideCommandHandler } from "./features/settings/guide.js";
import {
  settingsMenu,
  settingsCommandHandler,
  settingsSelectCallbackHandler,
} from "./features/settings/settings-menu.js";
import {
  settingsEditorConversation,
} from "./features/settings/settings-conversations.js";

export let i18nInstance: I18n<BotContext>;

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.BOT_TOKEN);
  const redis = getRedisClient();

  // Register bot API for standalone postActionCard usage
  registerBotApi(bot.api);

  // ── 0. Sequentialize ───────────────────────────────────────────────────────
  // Process updates from the same chat sequentially, different chats in parallel.
  // Prevents race conditions on per-group state (warn counts, mute state, etc.).
  // Must be installed before session so ordering applies to session reads too.
  bot.use(
    sequentialize((ctx: BotContext) => {
      const chatId = ctx.chat?.id?.toString();
      return chatId ? [chatId] : [];
    }),
  );

  // ── Session ────────────────────────────────────────────────────────────────
  bot.use(
    session<SessionData, BotContext>({
      initial: (): SessionData => ({}),
      storage: new RedisAdapter<SessionData>({ instance: redis }),
      getSessionKey: (ctx) => {
        const chatId = ctx.chat?.id;
        const userId = ctx.from?.id;
        if (!chatId || !userId) return undefined;
        return sessionKey(chatId, userId);
      },
    }),
  );

  // Global user registry tracker (opportunistic username & start-state tracker)
  bot.use(userRegistryMiddleware);

  // ── 1. i18n ───────────────────────────────────────────────────────────────
  // directory is resolved at runtime relative to this file's location.
  // NodeNext CJS: __dirname is available natively.
  i18nInstance = new I18n<BotContext>({
    defaultLocale: env.DEFAULT_LOCALE,
    useSession: true,
    directory: resolve(__dirname, "i18n"),
    localeNegotiator: (ctx) => {
      return (
        ctx.groupSettings?.locale ||
        ctx.session?.locale ||
        env.DEFAULT_LOCALE
      );
    },
  });

  bot.use(i18nInstance);

  // ── 2. Command parser ─────────────────────────────────────────────────────
  bot.use(commandParserMiddleware);

  // ── 3. Group settings ─────────────────────────────────────────────────────
  bot.use(groupSettingsMiddleware);

  // ── 4. Audit logger ───────────────────────────────────────────────────────
  bot.use(auditLoggerMiddleware);

  // ── 5. Anti-spam (Phase 2) ────────────────────────────────────────────────
  // Lighter-weight rate limiter for DoS self-protection (allows 5 msg/sec per user/chat)
  bot.use(
    limit({
      timeFrame: 1000,
      limit: 5,
      keyGenerator: (ctx) => {
        const chatId = ctx.chat?.id;
        const userId = ctx.from?.id;
        return chatId && userId ? `${chatId}:${userId}` : undefined;
      },
    })
  );

  // Per-group flood protection middleware
  bot.use(floodGuardMiddleware);

  // ── 6. Username Tracker (Phase 1) ─────────────────────────────────────────
  bot.use(usernameTrackerMiddleware);

  // ── 7. Group Registry ─────────────────────────────────────────────────────
  bot.use(groupRegistryMiddleware);

  // ── 7.5 Mentions Relay & Notify Middleware ────────────────────────────────
  bot.use(mentionHandlersMiddleware);

  // ── 8. Conversations ──────────────────────────────────────────────────────
  bot.use(conversations({ plugins: [i18nInstance] }));
  bot.use(createConversation(setLogChannelConversation, { id: "setLogChannel" }));
  bot.use(createConversation(settingsEditorConversation, { id: "settingsEditor" }));

  // Register Settings Menu
  bot.use(settingsMenu);

  // ── Commands ───────────────────────────────────────────────────────────────

  /**
   * /start — DM greeting.
   * Introduces the bot and explains how to add it to a group.
   * Works in both DMs and groups (but primarily intended for DMs).
   */
  bot.command("start", async (ctx) => {
    logger.info(
      { event: "cmd_start", userId: ctx.from?.id, chatType: ctx.chat?.type },
      "/start invoked",
    );
    await ctx.reply(ctx.t("start-greeting"));
  });

  /**
   * /ping (also !ping via command-parser) — health check smoke test.
   */
  bot.command("ping", async (ctx) => {
    logger.debug(
      { event: "cmd_ping", userId: ctx.from?.id, chatType: ctx.chat?.type },
      "/ping invoked",
    );
    await ctx.reply(ctx.t("ping-response"));
  });

  // ── Phase 1 command slots ──────────────────────────────────────────────────
  bot.command(["warn", "w"], requireAdmin(), warnHandler);
  bot.command(["mute", "m"], requireAdmin(), muteHandler);
  bot.command(["tban", "tb"], requireAdmin(), tbanHandler);
  bot.command(["ban", "b"], requireAdmin(), banHandler);
  bot.command("unmute", requireAdmin(), unmuteHandler);
  bot.command("unban", requireAdmin(), unbanHandler);

  // ── Callbacks ──────────────────────────────────────────────────────────────
  bot.callbackQuery(/^rm_warn:/, removeWarnHandler);
  bot.callbackQuery(/^captcha_approve:/, captchaCallbackHandler);
  bot.callbackQuery(/^resolve:/, resolveReportCallbackHandler);
  bot.callbackQuery(/^sel_set:/, settingsSelectCallbackHandler);

  // ── Settings commands ─────────────────────────────────────────────────────
  bot.command("setlogchannel", setLogChannelCommand);
  bot.command("welcome", requireAdmin(), welcomeToggleCommand);
  bot.command("setwelcome", requireAdmin(), setWelcomeCommand);
  bot.command("goodbye", requireAdmin(), goodbyeToggleCommand);
  bot.command("setgoodbye", requireAdmin(), setGoodbyeCommand);
  bot.command("captcha", requireAdmin(), captchaToggleCommand);
  bot.command("adminmention", requireAdmin(), adminMentionToggleCommand);
  bot.command("mentionnotify", requireAdmin(), mentionNotifyToggleCommand);
  bot.command("settings", settingsCommandHandler);
  bot.command("rules", rulesCommandHandler);
  bot.command("guide", guideCommandHandler);


  // ── Event handlers ────────────────────────────────────────────────────────
  bot.on("my_chat_member", myChatMemberHandler);
  bot.on("message:new_chat_members", onJoinHandler);
  bot.on("message:left_chat_member", onLeaveHandler);

  // ── Global error handler ──────────────────────────────────────────────────
  bot.catch((err) => {
    const ctx = err.ctx;
    const e = err.error;

    if (e instanceof GrammyError) {
      if (e.description.includes("message is not modified")) {
        logger.debug(
          { event: "grammy_message_not_modified", chat_id: ctx.chat?.id },
          "Telegram API warning: message is not modified",
        );
        return;
      }
      logger.error(
        {
          event: "grammy_error",
          error_code: e.error_code,
          description: e.description,
          chat_id: ctx.chat?.id,
          update_id: ctx.update.update_id,
        },
        "Telegram API error in handler",
      );
    } else if (e instanceof HttpError) {
      logger.error(
        {
          event: "http_error",
          cause: String(e.cause),
          chat_id: ctx.chat?.id,
        },
        "HTTP error communicating with Telegram",
      );
    } else if (e instanceof Error) {
      logger.error(
        {
          event: "handler_error",
          name: e.name,
          message: e.message,
          stack: e.stack,
          cause: (e as any).cause ? String((e as any).cause) : undefined,
          causeStack: (e as any).cause?.stack,
          chat_id: ctx.chat?.id,
        },
        "Unhandled error in bot handler",
      );
    } else {
      logger.error({ event: "unknown_error", raw: e }, "Unknown error type");
    }
  });

  return bot;
}
