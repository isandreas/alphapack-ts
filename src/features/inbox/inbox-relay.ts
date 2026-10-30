/**
 * features/inbox/inbox-relay.ts
 *
 * Implements:
 *   1. !sendmessage <chat_id> <message> (and /sendmessage <chat_id> <message>)
 *      - Allows the bot owner (for any active group) or a group admin (for groups
 *        they administer) to send a message or media into a targeted group on
 *        behalf of the bot from DM.
 *   2. User DM → Per-Group Inbox Relay
 *      - When a user sends a non-command private message to the bot, relays a
 *        formatted copy (with user info header + multi-group note if the user
 *        belongs to multiple groups with the bot) to every configured
 *        inboxGroupId for the groups the user is a member of.
 *   3. Inbox Admin Reply → User DM
 *      - When an admin in an inbox group replies to a relayed message, sends
 *        the reply (text or common media) to the original user's DM and reacts
 *        with ✅ (falling back to 👍 or a short confirmation reply if reactions
 *        are not supported/enabled in the group).
 */

import type { Message } from "grammy/types";
import type { BotContext } from "../../types/context.js";
import { env } from "../../config/env.js";
import { getRedisClient } from "../../db/redis.js";
import { inboxRelayMapKey, knownGroupsKey } from "../../db/keys.js";
import { isGroupAdmin } from "../../middlewares/admin-guard.js";
import { getGroupSettings } from "../../middlewares/group-settings.js";
import {
  getKnownGroups,
  isGroupBanned,
  parseGroupChatId,
  resolveCandidateGroupIds,
} from "../settings/group-registry.js";
import { hasStartedBot } from "../mentions/user-registry.js";
import { i18nInstance } from "../../bot.js";
import { logger } from "../../utils/logger.js";

/** Keep relayed message mappings in Redis for 30 days. */
const INBOX_RELAY_TTL_S = 30 * 24 * 60 * 60;

/** Maximum Telegram media caption length (1024 characters). */
const MAX_CAPTION_LENGTH = 1024;

export interface InboxRelayRecord {
  userId: number;
  sourceChatIds: number[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isBotOwner(userId: number): boolean {
  return env.OWNER_ID !== null && userId === env.OWNER_ID;
}

/**
 * Checks whether a user is currently a member/admin/creator of a group.
 */
async function isUserMemberOfGroup(
  ctx: BotContext,
  chatId: number,
  userId: number,
): Promise<boolean> {
  try {
    const member = await ctx.api.getChatMember(chatId, userId);
    if (
      member.status === "creator" ||
      member.status === "administrator" ||
      member.status === "member"
    ) {
      return true;
    }
    if (member.status === "restricted" && member.is_member) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── 1. !sendmessage <chat_id> <message> ───────────────────────────────────────

/**
 * Extracts `<chat_id>` and `<message>` from command arguments.
 * Preserves multi-line message bodies.
 */
function parseSendMessageArgs(rawArgs: string): {
  rawChatId: string;
  messageText: string;
} | null {
  const trimmed = rawArgs.trimStart();
  if (!trimmed) return null;

  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match || !match[1]) return null;

  return {
    rawChatId: match[1],
    messageText: match[2] ?? "",
  };
}

/**
 * Sends a text or media payload to `targetChatId` on behalf of the bot.
 * Supports direct text, media with caption, or replying to a message in DM.
 */
async function dispatchBotMessageToChat(
  ctx: BotContext,
  targetChatId: number,
  sourceMsg: Message,
  textOverride: string,
): Promise<boolean> {
  const replyMsg = sourceMsg.reply_to_message;

  // Choose media carrier: if current message has media, use it; otherwise if
  // replying to a media message in DM, use the replied-to message.
  const mediaMsg = hasMediaPayload(sourceMsg)
    ? sourceMsg
    : replyMsg && hasMediaPayload(replyMsg)
      ? replyMsg
      : null;

  if (mediaMsg) {
    const caption =
      textOverride ||
      (mediaMsg !== sourceMsg ? (mediaMsg.caption ?? "") : "") ||
      undefined;

    if (mediaMsg.photo && mediaMsg.photo.length > 0) {
      const photo = mediaMsg.photo[mediaMsg.photo.length - 1]!;
      await ctx.api.sendPhoto(
        targetChatId,
        photo.file_id,
        caption ? { caption } : undefined,
      );
      return true;
    }
    if (mediaMsg.video) {
      await ctx.api.sendVideo(
        targetChatId,
        mediaMsg.video.file_id,
        caption ? { caption } : undefined,
      );
      return true;
    }
    if (mediaMsg.document) {
      await ctx.api.sendDocument(
        targetChatId,
        mediaMsg.document.file_id,
        caption ? { caption } : undefined,
      );
      return true;
    }
    if (mediaMsg.animation) {
      await ctx.api.sendAnimation(
        targetChatId,
        mediaMsg.animation.file_id,
        caption ? { caption } : undefined,
      );
      return true;
    }
    if (mediaMsg.audio) {
      await ctx.api.sendAudio(
        targetChatId,
        mediaMsg.audio.file_id,
        caption ? { caption } : undefined,
      );
      return true;
    }
    if (mediaMsg.voice) {
      await ctx.api.sendVoice(
        targetChatId,
        mediaMsg.voice.file_id,
        caption ? { caption } : undefined,
      );
      return true;
    }
    if (mediaMsg.sticker) {
      await ctx.api.sendSticker(targetChatId, mediaMsg.sticker.file_id);
      if (textOverride) {
        await ctx.api.sendMessage(targetChatId, textOverride);
      }
      return true;
    }
  }

  const finalText = textOverride || replyMsg?.text || "";
  if (!finalText) {
    return false;
  }

  await ctx.api.sendMessage(targetChatId, finalText);
  return true;
}

function hasMediaPayload(msg: Message): boolean {
  return Boolean(
    (msg.photo && msg.photo.length > 0) ||
      msg.video ||
      msg.document ||
      msg.animation ||
      msg.audio ||
      msg.voice ||
      msg.sticker,
  );
}

/**
 * Handler for `/sendmessage <chat_id> <message>` and `!sendmessage <chat_id> <message>`.
 */
export async function sendMessageCommandHandler(
  ctx: BotContext,
): Promise<void> {
  const userId = ctx.from?.id;
  const chat = ctx.chat;
  const msg = ctx.message;
  if (!userId || !chat || !msg) return;

  if (chat.type !== "private") {
    // Only inform admins/owner that the command is DM-only; silently drop for regular users
    const isAdmin =
      isBotOwner(userId) || (await isGroupAdmin(ctx, chat.id, userId));
    if (!isAdmin) return;
    await ctx.reply(ctx.t("health_dm_only"));
    return;
  }

  // Extract raw args from ctx.match or from msg.text / msg.caption
  let rawMatch = typeof ctx.match === "string" ? ctx.match : "";
  if (!rawMatch) {
    const rawText = msg.text ?? msg.caption ?? "";
    const cmdMatch = /^\/sendmessage(?:@\w+)?(?:\s+([\s\S]*))?$/s.exec(rawText);
    if (cmdMatch && cmdMatch[1]) {
      rawMatch = cmdMatch[1];
    }
  }

  const parsedArgs = parseSendMessageArgs(rawMatch);
  if (!parsedArgs) {
    // Check if the user is owner or admin of at least one group before showing usage
    const knownGroups = await getKnownGroups();
    let authorizedAny = isBotOwner(userId);
    if (!authorizedAny) {
      for (const g of knownGroups) {
        if (await isGroupAdmin(ctx, g.chatId, userId)) {
          authorizedAny = true;
          break;
        }
      }
    }
    if (!authorizedAny) {
      await ctx.reply(ctx.t("error_admin_only"));
      return;
    }
    await ctx.reply(ctx.t("usage_sendmessage"));
    return;
  }

  const parsedChatId = parseGroupChatId(parsedArgs.rawChatId);
  if (parsedChatId === null) {
    await ctx.reply(ctx.t("usage_sendmessage"));
    return;
  }

  const { primaryId: targetChatId } =
    await resolveCandidateGroupIds(parsedChatId);

  if (await isGroupBanned(targetChatId)) {
    await ctx.reply(
      ctx.t("sendmessage_unauthorized", { chatId: String(targetChatId) }),
      { parse_mode: "HTML" },
    );
    return;
  }

  // Authorization check: Owner can send to any active group; Admins can send to groups they admin
  const authorized =
    isBotOwner(userId) || (await isGroupAdmin(ctx, targetChatId, userId));

  if (!authorized) {
    await ctx.reply(
      ctx.t("sendmessage_unauthorized", { chatId: String(targetChatId) }),
      { parse_mode: "HTML" },
    );
    return;
  }

  // Verify we have either message text or media payload
  const hasContent =
    Boolean(parsedArgs.messageText.trim()) ||
    hasMediaPayload(msg) ||
    Boolean(
      msg.reply_to_message &&
        (msg.reply_to_message.text || hasMediaPayload(msg.reply_to_message)),
    );

  if (!hasContent) {
    await ctx.reply(ctx.t("usage_sendmessage"));
    return;
  }

  const redis = getRedisClient();
  const groupTitle =
    (await redis.hget(knownGroupsKey(), String(targetChatId))) ||
    `Group ${targetChatId}`;

  try {
    const sent = await dispatchBotMessageToChat(
      ctx,
      targetChatId,
      msg,
      parsedArgs.messageText,
    );
    if (!sent) {
      await ctx.reply(ctx.t("usage_sendmessage"));
      return;
    }

    logger.info(
      {
        event: "cmd_sendmessage_sent",
        senderId: userId,
        targetChatId,
        groupTitle,
      },
      "Admin/Owner sent message to group on behalf of bot",
    );

    await ctx.reply(
      ctx.t("sendmessage_success", {
        title: escapeHtml(groupTitle),
        chatId: String(targetChatId),
      }),
      { parse_mode: "HTML" },
    );
  } catch (err: unknown) {
    logger.warn(
      { err, event: "cmd_sendmessage_failed", senderId: userId, targetChatId },
      "Failed to send message to target group via !sendmessage",
    );
    await ctx.reply(
      ctx.t("sendmessage_failed", {
        chatId: String(targetChatId),
      }),
      { parse_mode: "HTML" },
    );
  }
}

// ── 2. User DM → Inbox Group Relay & Admin Reply Handler ─────────────────────

/**
 * Formats the sender header for a relayed DM message.
 */
function buildInboxHeader(
  locale: string,
  sender: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  },
  sourceGroups: Array<{ chatId: number; title: string }>,
  allUserGroups: Array<{ chatId: number; title: string }>,
): string {
  const fullName =
    [sender.first_name, sender.last_name].filter(Boolean).join(" ") || "User";
  const senderLink = `<a href="tg://user?id=${sender.id}">${escapeHtml(fullName)}</a>`;
  const usernameDisplay = sender.username
    ? `@${escapeHtml(sender.username)}`
    : "-";
  const sourceGroupNames = sourceGroups
    .map((g) => `${escapeHtml(g.title)} (<code>${g.chatId}</code>)`)
    .join(", ");

  const lines: string[] = [
    i18nInstance.t(locale, "inbox_relay_header", {
      sender: senderLink,
      userId: String(sender.id),
      username: usernameDisplay,
      group: sourceGroupNames,
    }),
  ];

  if (allUserGroups.length > 1) {
    const allGroupList = allUserGroups
      .map((g) => escapeHtml(g.title))
      .join(", ");
    lines.push(
      i18nInstance.t(locale, "inbox_multi_group_note", {
        groups: allGroupList,
      }),
    );
  }

  return lines.join("\n");
}

/**
 * Stores the mapping from a message sent in the inbox group back to the DM sender.
 */
async function saveInboxRelayMapping(
  inboxChatId: number,
  inboxMessageId: number,
  record: InboxRelayRecord,
): Promise<void> {
  const redis = getRedisClient();
  await redis.set(
    inboxRelayMapKey(inboxChatId, inboxMessageId),
    JSON.stringify(record),
    "EX",
    INBOX_RELAY_TTL_S,
  );
}

/**
 * Sends a single formatted copy of the user's DM (text or media) to `inboxChatId`
 * and records the message ID(s) in Redis so admins can reply to it.
 */
async function sendFormattedCopyToInbox(
  ctx: BotContext,
  inboxChatId: number,
  headerHtml: string,
  msg: Message,
  record: InboxRelayRecord,
): Promise<void> {
  // 1. Plain text message
  if (msg.text !== undefined) {
    const fullHtml = `${headerHtml}\n\n${escapeHtml(msg.text)}`;
    const sent = await ctx.api.sendMessage(inboxChatId, fullHtml, {
      parse_mode: "HTML",
    });
    await saveInboxRelayMapping(inboxChatId, sent.message_id, record);
    return;
  }

  // 2. Sticker (stickers cannot carry captions, so send header first, then sticker as reply)
  if (msg.sticker) {
    const headerMsg = await ctx.api.sendMessage(inboxChatId, headerHtml, {
      parse_mode: "HTML",
    });
    await saveInboxRelayMapping(inboxChatId, headerMsg.message_id, record);

    const stickerMsg = await ctx.api.sendSticker(
      inboxChatId,
      msg.sticker.file_id,
      {
        reply_parameters: { message_id: headerMsg.message_id },
      },
    );
    await saveInboxRelayMapping(inboxChatId, stickerMsg.message_id, record);
    return;
  }

  // 3. Media with caption support (photo, video, document, animation, audio, voice)
  const userCaption = msg.caption ? escapeHtml(msg.caption) : "";
  const combinedCaption = userCaption
    ? `${headerHtml}\n\n${userCaption}`
    : headerHtml;

  // If the combined HTML fits within Telegram's caption limit, send as a single media message
  if (combinedCaption.length <= MAX_CAPTION_LENGTH) {
    let sent: Message | null = null;

    if (msg.photo && msg.photo.length > 0) {
      const photo = msg.photo[msg.photo.length - 1]!;
      sent = await ctx.api.sendPhoto(inboxChatId, photo.file_id, {
        caption: combinedCaption,
        parse_mode: "HTML",
      });
    } else if (msg.video) {
      sent = await ctx.api.sendVideo(inboxChatId, msg.video.file_id, {
        caption: combinedCaption,
        parse_mode: "HTML",
      });
    } else if (msg.document) {
      sent = await ctx.api.sendDocument(inboxChatId, msg.document.file_id, {
        caption: combinedCaption,
        parse_mode: "HTML",
      });
    } else if (msg.animation) {
      sent = await ctx.api.sendAnimation(inboxChatId, msg.animation.file_id, {
        caption: combinedCaption,
        parse_mode: "HTML",
      });
    } else if (msg.audio) {
      sent = await ctx.api.sendAudio(inboxChatId, msg.audio.file_id, {
        caption: combinedCaption,
        parse_mode: "HTML",
      });
    } else if (msg.voice) {
      sent = await ctx.api.sendVoice(inboxChatId, msg.voice.file_id, {
        caption: combinedCaption,
        parse_mode: "HTML",
      });
    }

    if (sent) {
      await saveInboxRelayMapping(inboxChatId, sent.message_id, record);
    }
    return;
  }

  // Fallback for very long captions (> 1024 chars): send header first, then media
  const headerMsg = await ctx.api.sendMessage(inboxChatId, headerHtml, {
    parse_mode: "HTML",
  });
  await saveInboxRelayMapping(inboxChatId, headerMsg.message_id, record);

  const replyOpts: {
    caption?: string;
    reply_parameters: { message_id: number };
  } = {
    reply_parameters: { message_id: headerMsg.message_id },
  };
  if (msg.caption !== undefined) {
    replyOpts.caption = msg.caption;
  }

  let mediaSent: Message | null = null;
  if (msg.photo && msg.photo.length > 0) {
    const photo = msg.photo[msg.photo.length - 1]!;
    mediaSent = await ctx.api.sendPhoto(inboxChatId, photo.file_id, replyOpts);
  } else if (msg.video) {
    mediaSent = await ctx.api.sendVideo(
      inboxChatId,
      msg.video.file_id,
      replyOpts,
    );
  } else if (msg.document) {
    mediaSent = await ctx.api.sendDocument(
      inboxChatId,
      msg.document.file_id,
      replyOpts,
    );
  } else if (msg.animation) {
    mediaSent = await ctx.api.sendAnimation(
      inboxChatId,
      msg.animation.file_id,
      replyOpts,
    );
  } else if (msg.audio) {
    mediaSent = await ctx.api.sendAudio(
      inboxChatId,
      msg.audio.file_id,
      replyOpts,
    );
  } else if (msg.voice) {
    mediaSent = await ctx.api.sendVoice(
      inboxChatId,
      msg.voice.file_id,
      replyOpts,
    );
  }

  if (mediaSent) {
    await saveInboxRelayMapping(inboxChatId, mediaSent.message_id, record);
  }
}

/**
 * Handles a private DM from a user and relays it to the configured inbox group(s)
 * of the groups where the user is a member.
 */
async function handleUserDmToInbox(ctx: BotContext): Promise<void> {
  const sender = ctx.from;
  const msg = ctx.message;
  if (!sender || sender.is_bot || !msg) return;

  const rawText = msg.text ?? msg.caption ?? "";

  // If this is a caption-based /sendmessage (since bot.command only matches msg.text),
  // dispatch to sendMessageCommandHandler.
  if ( msg.caption && /^\/sendmessage(?:@\w+)?(?:\s|$)/i.test(msg.caption)) {
    await sendMessageCommandHandler(ctx);
    return;
  }

  // Ignore any other commands
  if (rawText.startsWith("/") || rawText.startsWith("!")) {
    return;
  }

  // Only relay supported message types (text or common media)
  if (msg.text === undefined && !hasMediaPayload(msg)) {
    return;
  }

  // Verify user has started the bot privately
  const started = await hasStartedBot(sender.id);
  if (!started) return;

  const knownGroups = await getKnownGroups();
  if (knownGroups.length === 0) return;

  // Find all approved groups where this user is a member
  const userMemberGroups: Array<{ chatId: number; title: string }> = [];
  for (const group of knownGroups) {
    const isMember = await isUserMemberOfGroup(ctx, group.chatId, sender.id);
    if (isMember) {
      userMemberGroups.push(group);
    }
  }

  if (userMemberGroups.length === 0) return;

  // Group source groups by their configured inboxGroupId (deduplicating if multiple
  // groups share the same inbox group)
  const inboxTargets = new Map<
    number,
    {
      locale: string;
      sourceGroups: Array<{ chatId: number; title: string }>;
    }
  >();

  for (const group of userMemberGroups) {
    const settings = await getGroupSettings(group.chatId);
    const inboxGroupId = settings.inboxGroupId;
    if (inboxGroupId === null || inboxGroupId === undefined) continue;

    const existing = inboxTargets.get(inboxGroupId);
    if (existing) {
      existing.sourceGroups.push(group);
    } else {
      inboxTargets.set(inboxGroupId, {
        locale: settings.locale || env.DEFAULT_LOCALE,
        sourceGroups: [group],
      });
    }
  }

  if (inboxTargets.size === 0) return;

  for (const [inboxChatId, { locale, sourceGroups }] of inboxTargets.entries()) {
    try {
      const headerHtml = buildInboxHeader(
        locale,
        sender,
        sourceGroups,
        userMemberGroups,
      );
      const record: InboxRelayRecord = {
        userId: sender.id,
        sourceChatIds: sourceGroups.map((g) => g.chatId),
      };

      await sendFormattedCopyToInbox(ctx, inboxChatId, headerHtml, msg, record);
      logger.info(
        {
          event: "inbox_dm_relayed",
          userId: sender.id,
          inboxChatId,
          sourceChatIds: record.sourceChatIds,
        },
        "Relayed user DM to inbox group",
      );
    } catch (err: unknown) {
      logger.warn(
        {
          err,
          event: "inbox_dm_relay_failed",
          userId: sender.id,
          inboxChatId,
        },
        "Failed to relay user DM to inbox group",
      );
    }
  }
}

/**
 * Handles an admin's reply to a relayed message inside an inbox group,
 * delivering the reply back to the user's DM.
 */
async function handleInboxAdminReply(ctx: BotContext): Promise<void> {
  const chat = ctx.chat;
  const sender = ctx.from;
  const msg = ctx.message;
  const replyTo = msg?.reply_to_message;

  if (!chat || !sender || sender.is_bot || !msg || !replyTo) return;
  if (chat.type !== "group" && chat.type !== "supergroup") return;

  // Ignore commands so moderation commands (!warn, !ban, etc.) on relayed messages
  // are never treated as DM replies
  const rawText = msg.text ?? msg.caption ?? "";
  if (rawText.startsWith("/") || rawText.startsWith("!")) {
    return;
  }

  // Check if the replied-to message is a tracked inbox relay message
  const redis = getRedisClient();
  const rawRecord = await redis.get(
    inboxRelayMapKey(chat.id, replyTo.message_id),
  );
  if (!rawRecord) return;

  let record: InboxRelayRecord;
  try {
    record = JSON.parse(rawRecord) as InboxRelayRecord;
  } catch {
    return;
  }

  if (!record.userId) return;

  // Verify the replier is an admin of this inbox group (or bot owner)
  const isAdmin =
    isBotOwner(sender.id) || (await isGroupAdmin(ctx, chat.id, sender.id));
  if (!isAdmin) return;

  // Deliver the admin's message to the user's DM
  try {
    const sent = await dispatchBotMessageToChat(
      ctx,
      record.userId,
      msg,
      msg.text ?? msg.caption ?? "",
    );
    if (!sent) return;

    logger.info(
      {
        event: "inbox_admin_reply_delivered",
        adminId: sender.id,
        inboxChatId: chat.id,
        targetUserId: record.userId,
      },
      "Delivered admin inbox reply to user DM",
    );

    // Confirm delivery with ✅ reaction (fallback to 👍, then short reply if reaction fails)
    await confirmInboxReplyDelivery(ctx, chat.id, msg.message_id);
  } catch (err: unknown) {
    logger.warn(
      {
        err,
        event: "inbox_admin_reply_failed",
        adminId: sender.id,
        inboxChatId: chat.id,
        targetUserId: record.userId,
      },
      "Failed to deliver admin inbox reply to user DM",
    );

    try {
      await ctx.reply(ctx.t("inbox_reply_failed"), {
        reply_parameters: { message_id: msg.message_id },
      });
    } catch {
      // Ignore group reply error
    }
  }
}

/**
 * Reacts to the admin's reply message with ✅ (or 👍 if ✅ is not enabled in
 * standard group reactions), falling back to a short reply message if
 * reactions fail.
 */
async function confirmInboxReplyDelivery(
  ctx: BotContext,
  chatId: number,
  messageId: number,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.api.setMessageReaction(chatId, messageId, [
      { type: "emoji", emoji: "✅" as any },
    ]);
    return;
  } catch {
    // Fallback 1: standard 👍 emoji reaction
    try {
      await ctx.api.setMessageReaction(chatId, messageId, [
        { type: "emoji", emoji: "👍" },
      ]);
      return;
    } catch {
      // Fallback 2: short reply confirmation
      try {
        await ctx.reply(ctx.t("inbox_reply_sent"), {
          reply_parameters: { message_id: messageId },
        });
      } catch {
        // Ignore
      }
    }
  }
}

/**
 * Message handler registered on `bot.on("message", inboxRelayMessageHandler)`.
 * Routes private user DMs to inbox groups and admin replies in inbox groups back to users.
 */
export async function inboxRelayMessageHandler(
  ctx: BotContext,
): Promise<void> {
  const chatType = ctx.chat?.type;
  if (chatType === "private") {
    await handleUserDmToInbox(ctx);
  } else if (chatType === "group" || chatType === "supergroup") {
    await handleInboxAdminReply(ctx);
  }
}
