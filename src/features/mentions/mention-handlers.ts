import { GrammyError, type NextFunction } from "grammy";
import type { BotContext } from "../../types/context.js";
import { getRedisClient } from "../../db/redis.js";
import {
  adminRelayCooldownKey,
  mentionNotifyCooldownKey,
  reportKey,
  reportAdminMessagesKey,
  reportResolvedByKey,
} from "../../db/keys.js";
import { getGroupAdmins, isGroupAdmin } from "../../middlewares/admin-guard.js";
import { messageLink, privateGroupMessageLink } from "../../utils/deep-link.js";
import { resolveUsername, hasStartedBot } from "./user-registry.js";
import { logger } from "../../utils/logger.js";

/**
 * Explicit pacing delay (ms) between consecutive outgoing Telegram API calls
 * during multi-recipient `@admin` relay and `@username` mention notifications.
 * Respects Telegram's ~30 msg/sec global rate limit and avoids 429 errors.
 */
export const RELAY_PACE_MS = 75;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts `retry_after` (in seconds) from a Telegram 429 Too Many Requests error,
 * or returns null if the error is not a 429.
 */
function extractRetryAfterSeconds(err: unknown): number | null {
  if (err instanceof GrammyError && err.error_code === 429) {
    return typeof err.parameters?.retry_after === "number"
      ? err.parameters.retry_after
      : 1;
  }
  if (
    typeof err === "object" &&
    err !== null &&
    (err as { error_code?: unknown }).error_code === 429
  ) {
    const retryAfter = (err as { parameters?: { retry_after?: unknown } })
      .parameters?.retry_after;
    return typeof retryAfter === "number" ? retryAfter : 1;
  }
  return null;
}

/**
 * Executes a Telegram API call and respects `retry_after` backoff if a 429
 * Too Many Requests response is returned.
 */
export async function callWithRetryAfter<T>(
  fn: () => Promise<T>,
  contextInfo: Record<string, unknown>,
  maxRetries = 2,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const retryAfterSec = extractRetryAfterSeconds(err);
      if (retryAfterSec !== null && attempt < maxRetries) {
        logger.warn(
          {
            event: "telegram_429_backoff",
            retryAfterSec,
            attempt: attempt + 1,
            ...contextInfo,
          },
          `Telegram 429 Too Many Requests — backing off for ${retryAfterSec}s before retry`,
        );
        await sleep(retryAfterSec * 1_000);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Handles group messages containing @admin or user mentions.
 */
export async function mentionHandlersMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  // 1. Skip private chats, bot senders, and updates without message
  const chatId = ctx.chat?.id;
  const sender = ctx.from;
  if (!chatId || !sender || sender.is_bot || ctx.chat?.type === "private") {
    return await next();
  }

  const text = ctx.message?.text ?? ctx.message?.caption ?? "";
  if (!text) {
    return await next();
  }

  const settings = ctx.groupSettings;
  if (!settings) {
    return await next();
  }

  const redis = getRedisClient();

  // ── PART 1: @admin Relay ───────────────────────────────────────────────────
  const hasAdminTrigger = /(?:^|\s)@admin\b/i.test(text);

  if (hasAdminTrigger && settings.mentions.adminRelay.enabled) {
    const cooldownKey = adminRelayCooldownKey(chatId, sender.id);
    const isCooldown = await redis.get(cooldownKey);

    if (isCooldown) {
      // Reply with i18n cooldown warning
      try {
        await ctx.reply(ctx.t("error_admin_relay_cooldown"));
      } catch {
        // Ignore reply error in group
      }
    } else {
      // Set cooldown
      await redis.set(cooldownKey, "1", "EX", settings.mentions.adminRelay.cooldownSeconds);

      const triggerMessageId = ctx.message!.message_id;
      const senderName = [sender.first_name, sender.last_name].filter(Boolean).join(" ") || "User";

      // Create Report Record
      const rKey = reportKey(chatId, triggerMessageId);
      await redis.hset(rKey, {
        chatId: chatId.toString(),
        chatTitle: ctx.chat?.title || "Group",
        chatUsername: (ctx.chat && "username" in ctx.chat && ctx.chat.username) ? ctx.chat.username : "",
        messageId: triggerMessageId.toString(),
        senderId: sender.id.toString(),
        senderName,
        createdAt: Math.floor(Date.now() / 1000).toString(),
        resolved: "false",
      });
      await redis.expire(rKey, 7 * 24 * 60 * 60); // 7 days

      // Fetch group admins
      const adminIds = await getGroupAdmins(ctx, chatId);

      // Construct message links
      const msgLink = (ctx.chat && "username" in ctx.chat && ctx.chat.username)
        ? messageLink(ctx.chat.username, triggerMessageId)
        : privateGroupMessageLink(chatId, triggerMessageId);

      const infoText = `🔔 Admin report in <b>${ctx.chat?.title || "Group"}</b> from user <b>${senderName}</b>`;
      const replyMarkup = {
        inline_keyboard: [
          [
            { text: "🔗 Go to message", url: msgLink },
            { text: "✅ Resolve", callback_data: `resolve:${chatId}:${triggerMessageId}` },
          ],
        ],
      };

      const adminMsgsKey = reportAdminMessagesKey(chatId, triggerMessageId);

      // Relay to all admins (excluding bots, the sender themselves, and admins who haven't started DM)
      let isFirstAdminCall = true;
      for (const adminId of adminIds) {
        if (adminId === sender.id) continue;

        const isStarted = await hasStartedBot(adminId);
        if (!isStarted) continue;

        try {
          if (!isFirstAdminCall) {
            await sleep(RELAY_PACE_MS);
          }
          isFirstAdminCall = false;

          // Forward message with 429 backoff protection
          await callWithRetryAfter(
            () => ctx.api.forwardMessage(adminId, chatId, triggerMessageId),
            { chatId, adminId, triggerMessageId, op: "forwardMessage" },
          );

          await sleep(RELAY_PACE_MS);

          // Send report options info message with 429 backoff protection
          const infoMsg = await callWithRetryAfter(
            () =>
              ctx.api.sendMessage(adminId, infoText, {
                parse_mode: "HTML",
                reply_markup: replyMarkup,
              }),
            { chatId, adminId, triggerMessageId, op: "sendMessage" },
          );

          // Track the admin DM message ID
          await redis.hset(adminMsgsKey, adminId.toString(), infoMsg.message_id.toString());
        } catch (err: unknown) {
          logger.warn(
            { event: "admin_relay_failed", chatId, adminId, triggerMessageId, err },
            "Failed to relay report message to admin DM",
          );
        }
      }

      await redis.expire(adminMsgsKey, 7 * 24 * 60 * 60); // 7 days

      // Send confirmation to group
      try {
        await ctx.reply(ctx.t("reply_admin_notified"));
      } catch {
        // Ignore confirmation reply failure
      }
    }
  }

  // ── PART 2: @username Mention Notify ───────────────────────────────────────
  if (settings.mentions.userNotify.enabled) {
    const entities = ctx.message?.entities ?? ctx.message?.caption_entities ?? [];
    const targetsToNotify = new Set<number>();

    for (const entity of entities) {
      if (entity.type === "mention") {
        const username = text.substring(entity.offset + 1, entity.offset + entity.length);
        const resolvedId = await resolveUsername(username);
        if (resolvedId !== null) {
          targetsToNotify.add(resolvedId);
        }
      } else if (entity.type === "text_mention") {
        const targetUser = entity.user;
        if (targetUser && !targetUser.is_bot) {
          targetsToNotify.add(targetUser.id);
        }
      }
    }

    const senderName = [sender.first_name, sender.last_name].filter(Boolean).join(" ") || "User";

    // Notify targets with explicit pacing and 429 backoff
    let isFirstMentionCall = true;
    for (const targetId of targetsToNotify) {
      if (targetId === sender.id) continue;

      const isStarted = await hasStartedBot(targetId);
      if (!isStarted) continue;

      const mentionCooldownKey = mentionNotifyCooldownKey(chatId, targetId);
      const hasCooldown = await redis.get(mentionCooldownKey);
      if (hasCooldown) continue;

      // Set cooldown
      await redis.set(mentionCooldownKey, "1", "EX", settings.mentions.userNotify.cooldownSeconds);

      try {
        if (!isFirstMentionCall) {
          await sleep(RELAY_PACE_MS);
        }
        isFirstMentionCall = false;

        // Forward the triggering message first
        await callWithRetryAfter(
          () => ctx.api.forwardMessage(targetId, chatId, ctx.message!.message_id),
          { chatId, targetId, messageId: ctx.message?.message_id, op: "forwardMessage" },
        );

        await sleep(RELAY_PACE_MS);

        const dmText = ctx.t("dm_user_mentioned", {
          group: ctx.chat?.title || "Group",
          sender: senderName,
        });

        const msgLink = (ctx.chat && "username" in ctx.chat && ctx.chat.username)
          ? messageLink(ctx.chat.username, ctx.message!.message_id)
          : privateGroupMessageLink(chatId, ctx.message!.message_id);

        const replyMarkup = {
          inline_keyboard: [
            [
              { text: "🔗 Go to message", url: msgLink },
            ],
          ],
        };

        await callWithRetryAfter(
          () =>
            ctx.api.sendMessage(targetId, dmText, {
              parse_mode: "HTML",
              reply_markup: replyMarkup,
            }),
          { chatId, targetId, messageId: ctx.message?.message_id, op: "sendMessage" },
        );
      } catch (err: unknown) {
        logger.warn(
          { event: "mention_notify_failed", chatId, targetId, messageId: ctx.message?.message_id, err },
          "Failed to send DM mention notification to user",
        );
      }
    }
  }

  await next();
}

/**
 * Handles callback resolution clicks from admins' DMs: resolve:{chatId}:{messageId}
 */
export async function resolveReportCallbackHandler(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("resolve:")) return;

  const parts = data.split(":");
  const chatId = parseInt(parts[1] || "0", 10);
  const messageId = parseInt(parts[2] || "0", 10);
  const clickerId = ctx.from?.id;

  if (!chatId || !messageId || !clickerId) {
    await ctx.answerCallbackQuery({ text: "❌ Invalid resolution request.", show_alert: true });
    return;
  }

  const redis = getRedisClient();
  const rKey = reportKey(chatId, messageId);

  // 1. Look up report record
  const report = await redis.hgetall(rKey);
  if (!report || Object.keys(report).length === 0) {
    await ctx.answerCallbackQuery({ text: "⚠️ This report is no longer available.", show_alert: true });
    return;
  }

  // 2. Verify resolving user is still an admin of that group
  const isStillAdmin = await isGroupAdmin(ctx, chatId, clickerId);
  if (!isStillAdmin) {
    await ctx.answerCallbackQuery({ text: "❌ You are no longer an admin of this group.", show_alert: true });
    return;
  }

  // 3. Atomically claim resolution using SETNX to prevent race conditions
  const claimKey = reportResolvedByKey(chatId, messageId);
  const clickerName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "Admin";
  
  const claimPayload = JSON.stringify({
    userId: clickerId,
    displayName: clickerName,
    timestamp: Date.now(),
  });

  // NX = set only if not exists, EX = expire in 10 minutes
  const claimOk = await redis.set(claimKey, claimPayload, "EX", 600, "NX");
  
  if (!claimOk) {
    // Claim failed -> get winning resolver's name
    const resolverPayload = await redis.get(claimKey);
    let resolverName = "another admin";
    if (resolverPayload) {
      try {
        resolverName = JSON.parse(resolverPayload).displayName || resolverName;
      } catch (e) {}
    }
    await ctx.answerCallbackQuery({ text: `⚠️ Already resolved by ${resolverName}.`, show_alert: true });
    return;
  }

  // 4. Mark report resolved in Redis
  await redis.hset(rKey, {
    resolved: "true",
    resolvedBy: clickerName,
    resolvedAt: Math.floor(Date.now() / 1000).toString(),
  });

  // 5. Update every admin's info message text and buttons
  const adminMsgsKey = reportAdminMessagesKey(chatId, messageId);
  const adminMsgs = await redis.hgetall(adminMsgsKey);

  const dateStr = new Date().toISOString().replace("T", " ").substring(0, 19);
  const groupTitle = report.chatTitle || "Group";
  const updatedInfoText = `🔔 Admin report in <b>${groupTitle}</b> from user <b>${report.senderName}</b>\n\n✅ Resolved by <b>${clickerName}</b> at <code>${dateStr}</code>`;

  const msgLink = report.chatUsername
    ? messageLink(report.chatUsername, messageId)
    : privateGroupMessageLink(chatId, messageId);

  const updatedMarkup = {
    inline_keyboard: [
      [
        { text: "🔗 Go to message", url: msgLink },
      ],
    ],
  };

  let isFirstResolveEdit = true;
  for (const [adminIdStr, infoMsgIdStr] of Object.entries(adminMsgs)) {
    const adminId = parseInt(adminIdStr, 10);
    const infoMsgId = parseInt(infoMsgIdStr, 10);

    try {
      if (!isFirstResolveEdit) {
        await sleep(RELAY_PACE_MS);
      }
      isFirstResolveEdit = false;

      await callWithRetryAfter(
        () =>
          ctx.api.editMessageText(adminId, infoMsgId, updatedInfoText, {
            parse_mode: "HTML",
            reply_markup: updatedMarkup,
          }),
        { adminId, infoMsgId, chatId, messageId, op: "editMessageText" },
      );
    } catch (err: unknown) {
      // Admin might have deleted the message or blocked bot
      logger.debug(
        { event: "admin_edit_msg_failed", adminId, infoMsgId, chatId, messageId, err },
        "Failed to edit admin DM notification for resolved report",
      );
    }
  }

  await ctx.answerCallbackQuery({ text: "✅ Marked as resolved." });
}
