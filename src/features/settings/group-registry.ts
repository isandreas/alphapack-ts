/**
 * features/settings/group-registry.ts
 *
 * Group registry, owner approval workflow, and owner group management commands.
 *
 * Tracks:
 *   1. {chatId → chatTitle} in Redis hash `alphapack:bot:known_groups`
 *   2. Approved group chatIds in Redis set `alphapack:bot:approved_groups`
 *   3. Pending approval chatIds in Redis set `alphapack:bot:pending_approval_groups`
 *
 * Behaviour:
 *   - When the bot is added to a group (or already in an unapproved group on
 *     startup or incoming update), it sends 1 message in the group (in English)
 *     informing that the request will be evaluated by the bot owner, and asks
 *     the bot owner in DM for approval.
 *   - While waiting for owner confirmation, the bot sends NO further messages
 *     and performs NO actions in that group.
 *   - If the owner approves, the group is saved in Redis (`approved_groups`).
 *   - If the owner rejects, the bot sends a goodbye message in the group
 *     informing that the owner does not approve it to run, then leaves
 *     the group immediately.
 *   - Provides owner-only DM commands:
 *       • /activegroups (or !activegroups)
 *       • /exitgroup <chat_id> (or !exitgroup <chat_id>)
 */

import { GrammyError, type Api, type NextFunction } from "grammy";
import type { BotContext } from "../../types/context.js";
import { getRedisClient } from "../../db/redis.js";
import {
  approvedGroupsKey,
  bannedGroupsKey,
  groupSettingsKey,
  knownGroupsKey,
  pendingApprovalGroupsKey,
} from "../../db/keys.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { i18nInstance } from "../../bot.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Returns true if the group is approved by the owner in Redis.
 */
export async function isGroupApproved(chatId: number): Promise<boolean> {
  const redis = getRedisClient();
  const res = await redis.sismember(approvedGroupsKey(), String(chatId));
  return res === 1;
}

/**
 * Returns true if the group is banned by the owner in Redis.
 */
export async function isGroupBanned(chatId: number): Promise<boolean> {
  const redis = getRedisClient();
  const res = await redis.sismember(bannedGroupsKey(), String(chatId));
  return res === 1;
}

/**
 * Bans a group chatId in Redis and removes it from known, approved, and pending sets.
 */
export async function banGroup(chatId: number): Promise<void> {
  const redis = getRedisClient();
  const idStr = String(chatId);
  await redis.sadd(bannedGroupsKey(), idStr);
  await removeKnownGroup(chatId);
}

/**
 * Unbans a group chatId in Redis. Returns true if it was banned, false otherwise.
 */
export async function unbanGroup(chatId: number): Promise<boolean> {
  const redis = getRedisClient();
  const removed = await redis.srem(bannedGroupsKey(), String(chatId));
  return removed > 0;
}

/**
 * Marks a group as approved in Redis and removes it from the pending set.
 * Optionally upserts its title in the known groups hash.
 */
export async function approveGroup(
  chatId: number,
  chatTitle?: string,
): Promise<void> {
  const redis = getRedisClient();
  const idStr = String(chatId);
  await redis.sadd(approvedGroupsKey(), idStr);
  await redis.srem(pendingApprovalGroupsKey(), idStr);
  await redis.srem(bannedGroupsKey(), idStr);
  if (chatTitle) {
    await redis.hset(knownGroupsKey(), idStr, chatTitle);
  }
}

/**
 * Returns all groups known to the bot (both approved and unapproved): { chatId, title }.
 */
export async function getAllKnownGroups(): Promise<
  Array<{ chatId: number; title: string }>
> {
  const redis = getRedisClient();
  const hash = await redis.hgetall(knownGroupsKey());
  const result: Array<{ chatId: number; title: string }> = [];
  for (const [key, value] of Object.entries(hash)) {
    const chatId = parseInt(key, 10);
    if (!Number.isNaN(chatId)) {
      result.push({ chatId, title: value });
    }
  }
  return result;
}

/**
 * Returns an array of all approved active groups: { chatId, title }.
 * Uses an Array instead of a Map because Map is not JSON-serializable,
 * which crashes the grammY conversations replay engine.
 */
export async function getKnownGroups(): Promise<
  Array<{ chatId: number; title: string }>
> {
  const redis = getRedisClient();
  const [approvedIds, hash] = await Promise.all([
    redis.smembers(approvedGroupsKey()),
    redis.hgetall(knownGroupsKey()),
  ]);

  const result: Array<{ chatId: number; title: string }> = [];
  for (const idStr of approvedIds) {
    const chatId = parseInt(idStr, 10);
    if (!Number.isNaN(chatId)) {
      const title = hash[idStr] || `Group ${chatId}`;
      result.push({ chatId, title });
    }
  }
  return result;
}

/**
 * Removes a group from known, approved, and pending sets in Redis.
 */
export async function removeKnownGroup(chatId: number): Promise<void> {
  const redis = getRedisClient();
  const idStr = String(chatId);
  await Promise.all([
    redis.hdel(knownGroupsKey(), idStr),
    redis.srem(approvedGroupsKey(), idStr),
    redis.srem(pendingApprovalGroupsKey(), idStr),
  ]);
}

/**
 * Migrates all Redis group registry and settings state from a basic group chatId
 * to its upgraded supergroup chatId.
 */
export async function migrateGroupInRedis(
  oldChatId: number,
  newChatId: number,
  fallbackTitle?: string,
): Promise<void> {
  if (oldChatId === newChatId) return;
  const oldIdStr = String(oldChatId);
  const newIdStr = String(newChatId);
  const redis = getRedisClient();

  const existingTitle =
    fallbackTitle ||
    (await redis.hget(knownGroupsKey(), newIdStr)) ||
    (await redis.hget(knownGroupsKey(), oldIdStr)) ||
    `Group ${newChatId}`;

  await redis.hset(knownGroupsKey(), newIdStr, existingTitle);
  await redis.hdel(knownGroupsKey(), oldIdStr);

  if (await redis.sismember(approvedGroupsKey(), oldIdStr)) {
    await redis.sadd(approvedGroupsKey(), newIdStr);
    await redis.srem(approvedGroupsKey(), oldIdStr);
  }
  if (await redis.sismember(pendingApprovalGroupsKey(), oldIdStr)) {
    await redis.sadd(pendingApprovalGroupsKey(), newIdStr);
    await redis.srem(pendingApprovalGroupsKey(), oldIdStr);
  }
  if (await redis.sismember(bannedGroupsKey(), oldIdStr)) {
    await redis.sadd(bannedGroupsKey(), newIdStr);
    await redis.srem(bannedGroupsKey(), oldIdStr);
  }

  // Copy per-group settings hash if any overrides existed on the basic group
  const oldSettings = await redis.hgetall(groupSettingsKey(oldChatId));
  if (oldSettings && Object.keys(oldSettings).length > 0) {
    await redis.hset(groupSettingsKey(newChatId), oldSettings);
    await redis.del(groupSettingsKey(oldChatId));
  }

  logger.info(
    { event: "group_migrated_in_redis", oldChatId, newChatId, title: existingTitle },
    "Migrated basic group to supergroup in Redis",
  );
}

/**
 * Upserts a group title into the known groups registry.
 */
export async function upsertKnownGroup(
  chatId: number,
  chatTitle: string,
): Promise<void> {
  const redis = getRedisClient();
  await redis.hset(knownGroupsKey(), String(chatId), chatTitle);
}

/**
 * Sends an approval request DM to the bot owner if the group is not approved
 * and a request is not already pending.
 */
export async function requestGroupApprovalIfNeeded(
  api: Api,
  chatId: number,
  chatTitle: string,
  addedBy?: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  },
): Promise<void> {
  if (await isGroupBanned(chatId)) {
    return;
  }

  if (await isGroupApproved(chatId)) {
    return;
  }

  if (env.OWNER_ID === null) {
    logger.warn(
      { event: "group_approval_no_owner", chatId, chatTitle },
      "Group requires owner approval, but OWNER_ID is not configured",
    );
    return;
  }

  const redis = getRedisClient();
  const idStr = String(chatId);

  // Atomically mark as pending so concurrent/subsequent updates don't spam the owner
  const newlyPending = await redis.sadd(pendingApprovalGroupsKey(), idStr);
  if (newlyPending === 0) {
    return;
  }

  const locale = env.DEFAULT_LOCALE;
  let addedByLabel = "-";
  if (addedBy) {
    const fullName =
      [addedBy.first_name, addedBy.last_name].filter(Boolean).join(" ") ||
      addedBy.username ||
      String(addedBy.id);
    addedByLabel = `<a href="tg://user?id=${addedBy.id}">${escapeHtml(fullName)}</a> (<code>${addedBy.id}</code>)`;
  }

  const text = i18nInstance.t(locale, "group_approval_request", {
    title: escapeHtml(chatTitle),
    chatId: idStr,
    addedBy: addedByLabel,
  });

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: i18nInstance.t(locale, "btn_approve_group"),
          callback_data: `grp_approve:${chatId}`,
        },
        {
          text: i18nInstance.t(locale, "btn_reject_group"),
          callback_data: `grp_reject:${chatId}`,
        },
      ],
    ],
  };

  try {
    await api.sendMessage(env.OWNER_ID, text, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
      link_preview_options: { is_disabled: true },
    });
    logger.info(
      {
        event: "group_approval_requested",
        chatId,
        chatTitle,
        ownerId: env.OWNER_ID,
      },
      "Requested owner approval for group",
    );
  } catch (err: unknown) {
    // Roll back pending marker so future updates can retry sending the request
    await redis.srem(pendingApprovalGroupsKey(), idStr).catch(() => {});
    logger.error(
      { err, event: "group_approval_request_failed", chatId, chatTitle },
      "Failed to send group approval request DM to owner",
    );
    return;
  }

  // Send 1 message only in the group (in English) informing that the request
  // will be evaluated by the bot owner.
  try {
    const groupPendingNotice = i18nInstance.t("en", "group_approval_pending");
    await api.sendMessage(chatId, groupPendingNotice, {
      parse_mode: "HTML",
    });
  } catch (err: unknown) {
    logger.warn(
      { err, event: "group_approval_pending_notice_failed", chatId, chatTitle },
      "Failed to send pending approval notice to group",
    );
  }
}

/**
 * Reconciles known groups with Telegram API, discovering groups present in Redis
 * that are not yet recorded in known_groups.
 */
export async function reconcileKnownGroups(api: Api): Promise<void> {
  const redis = getRedisClient();
  const keys = await redis.keys("alphapack:-*");
  for (const k of keys) {
    const match = /^alphapack:(-?\d+)/.exec(k);
    if (match) {
      const id = parseInt(match[1]!, 10);
      if (!Number.isNaN(id) && id < 0) {
        const existing = await redis.hget(knownGroupsKey(), String(id));
        if (!existing) {
          try {
            const chat = await api.getChat(id);
            const title =
              chat && typeof chat === "object" && "title" in chat && chat.title
                ? chat.title
                : `Group ${id}`;
            await upsertKnownGroup(id, title);
          } catch (err: unknown) {
            if (err instanceof GrammyError && err.parameters?.migrate_to_chat_id) {
              await migrateGroupInRedis(id, err.parameters.migrate_to_chat_id);
            }
          }
        }
      }
    }
  }
}

/**
 * Checks all existing known groups in Redis at startup and asks the owner
 * for approval for any group that has not yet been approved.
 */
export async function checkExistingGroupsOnStartup(api: Api): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.persist(approvedGroupsKey());

    await reconcileKnownGroups(api);

    const knownGroups = await getAllKnownGroups();
    for (const { chatId, title } of knownGroups) {
      if (await isGroupBanned(chatId)) {
        await removeKnownGroup(chatId);
        await api.leaveChat(chatId).catch(() => {});
        continue;
      }

      let currentChatId = chatId;
      let currentTitle = title;
      try {
        const chat = await api.getChat(chatId);
        if (chat && typeof chat === "object" && "title" in chat && chat.title && chat.title !== title) {
          currentTitle = chat.title;
          await upsertKnownGroup(chatId, chat.title);
        }
      } catch (err: unknown) {
        if (err instanceof GrammyError && err.parameters?.migrate_to_chat_id) {
          const newId = err.parameters.migrate_to_chat_id;
          await migrateGroupInRedis(chatId, newId, title);
          currentChatId = newId;
        }
      }

      const approved = await isGroupApproved(currentChatId);
      if (!approved) {
        // Clear stale pending marker so owner gets re-prompted on startup
        await redis.srem(pendingApprovalGroupsKey(), String(currentChatId));
        await requestGroupApprovalIfNeeded(api, currentChatId, currentTitle);
      }
    }
  } catch (err: unknown) {
    logger.error(
      { err, event: "startup_group_approval_check_failed" },
      "Failed to check existing groups for owner approval at startup",
    );
  }
}

/**
 * Middleware: tracks groups and blocks all activity in unapproved or banned groups.
 * While waiting for the owner to confirm, the bot sends NO further messages and
 * performs NO actions in the group.
 */
export async function groupRegistryMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const chat = ctx.chat;
  if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) {
    await next();
    return;
  }

  // Allow my_chat_member updates through so myChatMemberHandler can process
  // bot join and leave transitions.
  if (ctx.myChatMember) {
    await next();
    return;
  }

  // Ignore the service message generated when the bot itself leaves a group
  if (
    ctx.message?.left_chat_member &&
    ctx.me &&
    ctx.message.left_chat_member.id === ctx.me.id
  ) {
    return;
  }

  // Handle basic group → supergroup migration so stored chatIds stay accurate
  if (ctx.message?.migrate_to_chat_id) {
    const newChatId = ctx.message.migrate_to_chat_id;
    const title =
      ("title" in chat && chat.title) ? chat.title : undefined;
    await migrateGroupInRedis(chat.id, newChatId, title);
    return;
  }

  if (ctx.message?.migrate_from_chat_id) {
    const oldChatId = ctx.message.migrate_from_chat_id;
    const title =
      ("title" in chat && chat.title) ? chat.title : undefined;
    await migrateGroupInRedis(oldChatId, chat.id, title);
  }

  // If the group is banned, leave immediately without notifying or asking the owner
  if (await isGroupBanned(chat.id)) {
    await removeKnownGroup(chat.id);
    await ctx.api.leaveChat(chat.id).catch(() => {});
    return;
  }

  const chatTitle =
    "title" in chat && chat.title ? chat.title : `Group ${chat.id}`;

  await upsertKnownGroup(chat.id, chatTitle).catch((err: unknown) => {
    logger.debug(
      { err, event: "group_registry_upsert_failed", chatId: chat.id },
      "Failed to upsert group in registry",
    );
  });

  const approved = await isGroupApproved(chat.id);
  if (!approved) {
    await requestGroupApprovalIfNeeded(ctx.api, chat.id, chatTitle, ctx.from);
    // Block all downstream middlewares and handlers for unapproved groups
    return;
  }

  await next();
}

/**
 * Handler for my_chat_member events.
 * Tracks when the bot is added to or removed from groups.
 */
export async function myChatMemberHandler(ctx: BotContext): Promise<void> {
  const update = ctx.myChatMember;
  if (!update) return;

  const chat = update.chat;
  const newStatus = update.new_chat_member.status;

  // Only track group/supergroup chats
  if (chat.type !== "group" && chat.type !== "supergroup") return;

  const chatTitle = chat.title || `Group ${chat.id}`;

  if (
    newStatus === "member" ||
    newStatus === "administrator" ||
    (newStatus === "restricted" && update.new_chat_member.is_member)
  ) {
    if (await isGroupBanned(chat.id)) {
      await removeKnownGroup(chat.id);
      await ctx.api.leaveChat(chat.id).catch((err: unknown) => {
        logger.warn(
          { err, event: "banned_group_leave_failed", chatId: chat.id },
          "Failed to leave banned group upon invite",
        );
      });
      logger.info(
        { event: "bot_added_to_banned_group", chatId: chat.id, chatTitle },
        "Bot added to banned group — left immediately without prompting owner",
      );
      return;
    }

    await upsertKnownGroup(chat.id, chatTitle);
    logger.info(
      { event: "bot_added_to_group", chatId: chat.id, chatTitle },
      "Bot added to group — registered in group registry",
    );

    const approved = await isGroupApproved(chat.id);
    if (!approved) {
      await requestGroupApprovalIfNeeded(
        ctx.api,
        chat.id,
        chatTitle,
        update.from,
      );
    }
  } else if (
    newStatus === "left" ||
    newStatus === "kicked" ||
    (newStatus === "restricted" && !update.new_chat_member.is_member)
  ) {
    await removeKnownGroup(chat.id);
    logger.info(
      { event: "bot_removed_from_group", chatId: chat.id, chatTitle },
      "Bot removed from group — unregistered from group registry",
    );
  }
}

/**
 * Callback query handler for owner approval/rejection buttons:
 *   grp_approve:<chatId>
 *   grp_reject:<chatId>
 */
export async function groupApprovalCallbackHandler(
  ctx: BotContext,
): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const match = /^grp_(approve|reject):(-?\d+)$/.exec(data);
  if (!match) return;

  const userId = ctx.from?.id;
  if (!userId || env.OWNER_ID === null || userId !== env.OWNER_ID) {
    await ctx.answerCallbackQuery({
      text: ctx.t("error_owner_only"),
      show_alert: true,
    });
    return;
  }

  const action = match[1] as "approve" | "reject";
  const targetChatId = parseInt(match[2]!, 10);
  if (Number.isNaN(targetChatId)) return;

  const redis = getRedisClient();
  const chatTitle =
    (await redis.hget(knownGroupsKey(), String(targetChatId))) ||
    `Group ${targetChatId}`;

  if (action === "approve") {
    await approveGroup(targetChatId, chatTitle);
    logger.info(
      { event: "group_approved_by_owner", chatId: targetChatId, chatTitle },
      "Owner approved bot to run in group",
    );

    // Inform the group that the request is approved and admins can configure with /settings
    try {
      const approvedNotice = i18nInstance.t("en", "group_approved_notice");
      await ctx.api.sendMessage(targetChatId, approvedNotice, {
        parse_mode: "HTML",
      });
    } catch (err: unknown) {
      const migratedId =
        err instanceof GrammyError
          ? err.parameters?.migrate_to_chat_id
          : undefined;
      if (typeof migratedId === "number") {
        await migrateGroupInRedis(targetChatId, migratedId, chatTitle);
        try {
          const approvedNotice = i18nInstance.t("en", "group_approved_notice");
          await ctx.api.sendMessage(migratedId, approvedNotice, {
            parse_mode: "HTML",
          });
        } catch {
          // ignore
        }
      } else {
        logger.warn(
          { err, event: "group_approved_notice_failed", chatId: targetChatId },
          "Failed to send approval notice in group",
        );
      }
    }

    await ctx.answerCallbackQuery();
    try {
      await ctx.editMessageText(
        ctx.t("group_approval_approved", {
          title: escapeHtml(chatTitle),
          chatId: String(targetChatId),
        }),
        { parse_mode: "HTML" },
      );
    } catch (err: unknown) {
      logger.debug(
        { err, event: "group_approval_edit_msg_failed", chatId: targetChatId },
        "Failed to edit approval message",
      );
    }
  } else {
    // Owner rejected — send goodbye in group (in English) and leave immediately
    await removeKnownGroup(targetChatId);

    try {
      const goodbyeText = i18nInstance.t("en", "group_rejected_goodbye");
      await ctx.api.sendMessage(targetChatId, goodbyeText, {
        parse_mode: "HTML",
      });
    } catch (err: unknown) {
      logger.warn(
        { err, event: "group_reject_goodbye_failed", chatId: targetChatId },
        "Failed to send rejection goodbye message in group",
      );
    }

    try {
      await ctx.api.leaveChat(targetChatId);
    } catch (err: unknown) {
      logger.warn(
        { err, event: "group_reject_leave_failed", chatId: targetChatId },
        "Failed to leave group after owner rejection",
      );
    }

    logger.info(
      { event: "group_rejected_by_owner", chatId: targetChatId, chatTitle },
      "Owner rejected group — sent goodbye and left group",
    );

    await ctx.answerCallbackQuery();
    try {
      await ctx.editMessageText(
        ctx.t("group_approval_rejected", {
          title: escapeHtml(chatTitle),
          chatId: String(targetChatId),
        }),
        { parse_mode: "HTML" },
      );
    } catch (err: unknown) {
      logger.debug(
        { err, event: "group_rejection_edit_msg_failed", chatId: targetChatId },
        "Failed to edit rejection message",
      );
    }
  }
}

/**
 * Owner-only DM command: /activegroups or !activegroups
 * Lists all approved active groups stored in Redis.
 */
export async function activeGroupsCommandHandler(
  ctx: BotContext,
): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply(ctx.t("health_dm_only"));
    return;
  }

  const userId = ctx.from?.id;
  if (!userId) return;

  if (env.OWNER_ID === null || userId !== env.OWNER_ID) {
    await ctx.reply(ctx.t("error_owner_only"));
    return;
  }

  const groups = await getKnownGroups();
  if (groups.length === 0) {
    await ctx.reply(ctx.t("activegroups_empty"));
    return;
  }

  const header = ctx.t("activegroups_header", {
    count: String(groups.length),
  });
  const lines = groups.map(
    (g, idx) =>
      `${idx + 1}. <b>${escapeHtml(g.title)}</b> — <code>${g.chatId}</code>`,
  );

  await ctx.reply(`${header}\n\n${lines.join("\n")}`, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

/**
 * Parses a group chat_id argument from a command, stripping invisible Unicode
 * formatting/isolation marks and normalizing positive numbers to negative
 * (since all Telegram group and supergroup chat_ids are negative).
 */
export function parseGroupChatId(raw: string): number | null {
  const cleaned = raw
    .replace(/[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff<>]/g, "")
    .trim();
  if (!cleaned || !/^-?\d+$/.test(cleaned)) {
    return null;
  }
  const parsed = parseInt(cleaned, 10);
  if (Number.isNaN(parsed) || parsed === 0) {
    return null;
  }
  // All group and supergroup IDs in Telegram are negative
  return parsed > 0 ? -parsed : parsed;
}

/**
 * Resolves candidate group chat_ids (handling e.g. missing `-100` supergroup
 * prefix or basic-to-supergroup ID variants) against Redis registries.
 */
export async function resolveCandidateGroupIds(
  inputChatId: number,
): Promise<{ primaryId: number; allCandidates: number[] }> {
  const absStr = String(Math.abs(inputChatId));
  const candidates: number[] = [inputChatId];

  if (!absStr.startsWith("100")) {
    const sgCandidate = -Number(`100${absStr}`);
    if (!Number.isNaN(sgCandidate) && Number.isSafeInteger(sgCandidate)) {
      candidates.push(sgCandidate);
    }
  } else if (absStr.length > 3) {
    const basicCandidate = -Number(absStr.slice(3));
    if (
      !Number.isNaN(basicCandidate) &&
      basicCandidate !== 0 &&
      Number.isSafeInteger(basicCandidate)
    ) {
      candidates.push(basicCandidate);
    }
  }

  const redis = getRedisClient();
  for (const cid of candidates) {
    const cidStr = String(cid);
    const [knownTitle, isApp, isPend, isBan] = await Promise.all([
      redis.hget(knownGroupsKey(), cidStr),
      redis.sismember(approvedGroupsKey(), cidStr),
      redis.sismember(pendingApprovalGroupsKey(), cidStr),
      redis.sismember(bannedGroupsKey(), cidStr),
    ]);
    if (knownTitle !== null || isApp === 1 || isPend === 1 || isBan === 1) {
      const reordered = [cid, ...candidates.filter((x) => x !== cid)];
      return { primaryId: cid, allCandidates: reordered };
    }
  }

  return { primaryId: inputChatId, allCandidates: candidates };
}

/**
 * Leaves a group on Telegram trying all candidate IDs and handling supergroup
 * migration redirects (`migrate_to_chat_id`).
 * Returns true if the bot left the group or was already not a member.
 */
async function leaveGroupOnTelegram(
  api: Api,
  candidates: number[],
  onMigratedOrMatchedId?: (chatId: number) => Promise<void>,
): Promise<boolean> {
  for (const candidateId of candidates) {
    try {
      await api.leaveChat(candidateId);
      if (onMigratedOrMatchedId) {
        await onMigratedOrMatchedId(candidateId);
      }
      return true;
    } catch (err: unknown) {
      if (err instanceof GrammyError) {
        const migratedId = err.parameters?.migrate_to_chat_id;
        if (typeof migratedId === "number") {
          if (onMigratedOrMatchedId) {
            await onMigratedOrMatchedId(migratedId);
          }
          try {
            await api.leaveChat(migratedId);
            return true;
          } catch (migratedErr: unknown) {
            logger.warn(
              {
                err: migratedErr,
                event: "leave_migrated_group_failed",
                chatId: migratedId,
              },
              "Failed to leave migrated supergroup",
            );
          }
        }

        const desc = err.description.toLowerCase();
        if (
          desc.includes("bot is not a member") ||
          desc.includes("bot was kicked") ||
          desc.includes("user not found")
        ) {
          // Bot is already out of this group
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Owner-only DM command: /exitgroup <chat_id> or !exitgroup <chat_id>
 * Removes the group from Redis and makes the bot leave the group immediately.
 */
export async function exitGroupCommandHandler(ctx: BotContext): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply(ctx.t("health_dm_only"));
    return;
  }

  const userId = ctx.from?.id;
  if (!userId) return;

  if (env.OWNER_ID === null || userId !== env.OWNER_ID) {
    await ctx.reply(ctx.t("error_owner_only"));
    return;
  }

  const rawArg = typeof ctx.match === "string" ? ctx.match : "";
  const parsedChatId = parseGroupChatId(rawArg);
  if (parsedChatId === null) {
    await ctx.reply(ctx.t("usage_exitgroup"));
    return;
  }

  const { primaryId: targetChatId, allCandidates } =
    await resolveCandidateGroupIds(parsedChatId);

  const redis = getRedisClient();
  const title =
    (await redis.hget(knownGroupsKey(), String(targetChatId))) ||
    `Group ${targetChatId}`;

  for (const cid of allCandidates) {
    await removeKnownGroup(cid);
  }

  const leftOk = await leaveGroupOnTelegram(
    ctx.api,
    allCandidates,
    async (resolvedId) => {
      await removeKnownGroup(resolvedId);
    },
  );

  if (leftOk) {
    logger.info(
      { event: "owner_exitgroup", chatId: targetChatId, title },
      "Owner executed /exitgroup — left group and removed from active groups",
    );
    await ctx.reply(
      ctx.t("exitgroup_success", {
        title: escapeHtml(title),
        chatId: String(targetChatId),
      }),
      { parse_mode: "HTML" },
    );
  } else {
    logger.warn(
      { event: "owner_exitgroup_leave_failed", chatId: targetChatId },
      "Failed to call leaveChat on Telegram during /exitgroup",
    );
    await ctx.reply(
      ctx.t("exitgroup_failed", {
        chatId: String(targetChatId),
      }),
      { parse_mode: "HTML" },
    );
  }
}

/**
 * Owner-only DM command: /bangroup <chat_id> or !bangroup <chat_id>
 * Bans a group chat_id in Redis, removes it from active/pending registries,
 * and leaves the group immediately if the bot is in it.
 */
export async function banGroupCommandHandler(ctx: BotContext): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply(ctx.t("health_dm_only"));
    return;
  }

  const userId = ctx.from?.id;
  if (!userId) return;

  if (env.OWNER_ID === null || userId !== env.OWNER_ID) {
    await ctx.reply(ctx.t("error_owner_only"));
    return;
  }

  const rawArg = typeof ctx.match === "string" ? ctx.match : "";
  const parsedChatId = parseGroupChatId(rawArg);
  if (parsedChatId === null) {
    await ctx.reply(ctx.t("usage_bangroup"));
    return;
  }

  const { primaryId: targetChatId, allCandidates } =
    await resolveCandidateGroupIds(parsedChatId);

  await banGroup(targetChatId);

  await leaveGroupOnTelegram(ctx.api, allCandidates, async (resolvedId) => {
    await banGroup(resolvedId);
  });

  logger.info(
    { event: "owner_bangroup", chatId: targetChatId },
    "Owner banned group chat_id and left group",
  );

  await ctx.reply(
    ctx.t("bangroup_success", { chatId: String(targetChatId) }),
    { parse_mode: "HTML" },
  );
}

/**
 * Owner-only DM command: /unbangroup <chat_id> or !unbangroup <chat_id>
 * Removes a group chat_id from the banned set in Redis.
 */
export async function unbanGroupCommandHandler(ctx: BotContext): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply(ctx.t("health_dm_only"));
    return;
  }

  const userId = ctx.from?.id;
  if (!userId) return;

  if (env.OWNER_ID === null || userId !== env.OWNER_ID) {
    await ctx.reply(ctx.t("error_owner_only"));
    return;
  }

  const rawArg = typeof ctx.match === "string" ? ctx.match : "";
  const parsedChatId = parseGroupChatId(rawArg);
  if (parsedChatId === null) {
    await ctx.reply(ctx.t("usage_unbangroup"));
    return;
  }

  const { primaryId: targetChatId, allCandidates } =
    await resolveCandidateGroupIds(parsedChatId);

  let wasBanned = false;
  for (const cid of allCandidates) {
    if (await unbanGroup(cid)) {
      wasBanned = true;
    }
  }

  logger.info(
    { event: "owner_unbangroup", chatId: targetChatId, wasBanned },
    "Owner unbanned group chat_id",
  );

  if (wasBanned) {
    await ctx.reply(
      ctx.t("unbangroup_success", { chatId: String(targetChatId) }),
      { parse_mode: "HTML" },
    );
  } else {
    await ctx.reply(
      ctx.t("unbangroup_not_banned", { chatId: String(targetChatId) }),
      { parse_mode: "HTML" },
    );
  }
}
