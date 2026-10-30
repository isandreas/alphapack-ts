/**
 * features/settings/set-inbox-group.ts
 *
 * grammY conversations & handlers:
 *   1. !setinboxgroup / /setinboxgroup
 *      - DM-only 2-step flow for admins to configure a group's inbox group.
 *      - Includes a Cancel button on both Step 1 and Step 2 to close the session.
 *      - Excludes the selected source group from Step 2 target options.
 *   2. !unsetinboxgroup / /unsetinboxgroup
 *      - DM-only flow (supports optional <chat_id> argument or interactive group
 *        selection with a Cancel button) to remove/disable a group's inbox group.
 *
 * Access control:
 *   - Regular users (not owner and not admin of any known group) receive NO
 *     response at all — commands are silently ignored.
 */

import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../../types/context.js";
import {
  getKnownGroups,
  parseGroupChatId,
  reconcileKnownGroups,
  resolveCandidateGroupIds,
} from "./group-registry.js";
import { isGroupAdmin } from "../../middlewares/admin-guard.js";
import {
  getGroupSettings,
  setGroupSetting,
} from "../../middlewares/group-settings.js";
import { env } from "../../config/env.js";
import { getRedisClient } from "../../db/redis.js";
import { knownGroupsKey } from "../../db/keys.js";
import { logger } from "../../utils/logger.js";

type InboxGroupConversation = Conversation<BotContext, BotContext>;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isBotOwner(userId: number): boolean {
  return env.OWNER_ID !== null && userId === env.OWNER_ID;
}

function getCancelLabel(ctx: BotContext): string {
  const translated = ctx.t("setinboxgroup_btn_cancel");
  return translated.startsWith("{") ? "❌ Cancel" : translated;
}

/**
 * Checks if the user is an admin in the given group (or is the bot owner).
 */
async function isAdminOrOwner(
  ctx: BotContext,
  chatId: number,
  userId: number,
): Promise<boolean> {
  if (isBotOwner(userId)) return true;
  return await isGroupAdmin(ctx, chatId, userId);
}

/**
 * Returns true if the user is the bot owner or an admin in at least one approved group.
 */
async function isUserAnyGroupAdminOrOwner(
  ctx: BotContext,
  userId: number,
): Promise<boolean> {
  if (isBotOwner(userId)) return true;
  const knownGroups = await getKnownGroups();
  for (const g of knownGroups) {
    if (await isAdminOrOwner(ctx, g.chatId, userId)) {
      return true;
    }
  }
  return false;
}

/**
 * Command handler for /setinboxgroup and !setinboxgroup.
 * Silently drops non-admin invocations so regular users never discover the command.
 */
export async function setInboxGroupCommand(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  const chat = ctx.chat;
  if (!userId || !chat) return;

  if (chat.type !== "private") {
    const allowed = await isAdminOrOwner(ctx, chat.id, userId);
    if (!allowed) return;
    await ctx.reply(ctx.t("setinboxgroup_dm_only"));
    return;
  }

  const isAnyGroupAdmin = await isUserAnyGroupAdminOrOwner(ctx, userId);
  if (!isAnyGroupAdmin) {
    logger.debug(
      { event: "setinboxgroup_non_admin_dropped", userId },
      "Non-admin attempted !setinboxgroup in DM — silently dropped",
    );
    return;
  }

  await ctx.conversation.enter("setInboxGroup");
}

/**
 * Conversation registered via createConversation(setInboxGroupConversation, { id: "setInboxGroup" }).
 */
export async function setInboxGroupConversation(
  conversation: InboxGroupConversation,
  ctx: BotContext,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  await ctx.reply(ctx.t("setinboxgroup_checking"));

  await conversation.external(() => reconcileKnownGroups(ctx.api));
  const knownGroups = await conversation.external(() => getKnownGroups());
  if (knownGroups.length === 0) {
    await ctx.reply(ctx.t("setinboxgroup_no_groups"));
    return;
  }

  const adminGroups: Array<{ chatId: number; title: string }> = [];
  for (const { chatId: groupChatId, title } of knownGroups) {
    const isAdmin = await isAdminOrOwner(ctx, groupChatId, userId);
    if (isAdmin) {
      adminGroups.push({ chatId: groupChatId, title });
    }
  }

  if (adminGroups.length === 0) {
    await ctx.reply(ctx.t("setinboxgroup_no_groups"));
    return;
  }

  if (adminGroups.length < 2) {
    await ctx.reply(ctx.t("setinboxgroup_min_two_groups"));
    return;
  }

  // ── Step 1: Select the source group (with Cancel button) ────────────────────
  const step1Buttons = adminGroups.map((g) => [
    { text: g.title, callback_data: `sig_src:${g.chatId}` },
  ]);
  step1Buttons.push([
    {
      text: getCancelLabel(ctx),
      callback_data: "sig_src:cancel",
    },
  ]);

  await ctx.reply(ctx.t("setinboxgroup_select_source"), {
    reply_markup: { inline_keyboard: step1Buttons },
  });

  const srcSelectionCtx = await conversation.waitForCallbackQuery(/^sig_src:/);
  const srcPayload = srcSelectionCtx.callbackQuery.data.slice("sig_src:".length);

  if (srcPayload === "cancel") {
    await srcSelectionCtx.answerCallbackQuery();
    try {
      await srcSelectionCtx.editMessageText(
        srcSelectionCtx.t("setinboxgroup_cancelled"),
      );
    } catch {
      await srcSelectionCtx.reply(srcSelectionCtx.t("setinboxgroup_cancelled"));
    }
    return;
  }

  const selectedSourceChatId = parseInt(srcPayload || "0", 10);
  const selectedSourceGroup = adminGroups.find(
    (g) => g.chatId === selectedSourceChatId,
  );
  if (!selectedSourceGroup) {
    await srcSelectionCtx.answerCallbackQuery("Invalid selection");
    return;
  }

  await srcSelectionCtx.answerCallbackQuery();

  // ── Step 2: Select target inbox group (excluding the source group + Cancel) ─
  const targetCandidates = adminGroups.filter(
    (g) => g.chatId !== selectedSourceGroup.chatId,
  );

  const targetButtons = targetCandidates.map((g) => [
    {
      text: `${g.title} (${g.chatId})`,
      callback_data: `sig_dst:${g.chatId}`,
    },
  ]);
  targetButtons.push([
    {
      text: getCancelLabel(srcSelectionCtx),
      callback_data: "sig_dst:cancel",
    },
  ]);

  await srcSelectionCtx.reply(
    srcSelectionCtx.t("setinboxgroup_select_target", {
      group: escapeHtml(selectedSourceGroup.title),
    }),
    {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: targetButtons },
    },
  );

  // Wait for either a button click (sig_dst:...) or a text message with <chat_id>
  const step2Ctx = await conversation.wait();

  let rawTargetChatId: number | null = null;
  const replyCtx: BotContext = step2Ctx;

  if (step2Ctx.callbackQuery?.data?.startsWith("sig_dst:")) {
    const payload = step2Ctx.callbackQuery.data.slice("sig_dst:".length);
    await step2Ctx.answerCallbackQuery();

    if (payload === "cancel") {
      try {
        await step2Ctx.editMessageText(step2Ctx.t("setinboxgroup_cancelled"));
      } catch {
        await step2Ctx.reply(step2Ctx.t("setinboxgroup_cancelled"));
      }
      return;
    }

    rawTargetChatId = parseGroupChatId(payload);
  } else if (step2Ctx.message?.text) {
    rawTargetChatId = parseGroupChatId(step2Ctx.message.text);
  }

  if (rawTargetChatId === null) {
    await replyCtx.reply(replyCtx.t("setinboxgroup_invalid_target"));
    return;
  }

  const { primaryId: targetInboxChatId } = await conversation.external(() =>
    resolveCandidateGroupIds(rawTargetChatId!),
  );

  // Disallow setting a group as its own inbox group
  if (targetInboxChatId === selectedSourceGroup.chatId) {
    await replyCtx.reply(replyCtx.t("setinboxgroup_same_group_error"));
    return;
  }

  // ── 3. Verify user is admin in target inbox group ───────────────────────────
  const isTargetAdmin = await isAdminOrOwner(ctx, targetInboxChatId, userId);
  if (!isTargetAdmin) {
    await replyCtx.reply(replyCtx.t("setinboxgroup_not_target_admin"));
    return;
  }

  // ── 4. Verify bot is member/admin in target inbox group ─────────────────────
  const botId = ctx.me.id;
  let botCanPost = false;
  try {
    const botMember = await ctx.api.getChatMember(targetInboxChatId, botId);
    if (
      botMember.status === "administrator" ||
      botMember.status === "creator" ||
      botMember.status === "member"
    ) {
      botCanPost = true;
    } else if (
      botMember.status === "restricted" &&
      botMember.is_member &&
      botMember.can_send_messages
    ) {
      botCanPost = true;
    }
  } catch (err: unknown) {
    logger.debug(
      { err, event: "setinboxgroup_bot_check_failed", targetInboxChatId },
      "Failed to check bot membership in target inbox group",
    );
    botCanPost = false;
  }

  if (!botCanPost) {
    await replyCtx.reply(replyCtx.t("setinboxgroup_bot_not_member"));
    return;
  }

  // Resolve target group title
  const targetGroupTitle = await conversation.external(async () => {
    const redis = getRedisClient();
    const knownTitle = await redis.hget(
      knownGroupsKey(),
      String(targetInboxChatId),
    );
    return knownTitle || `Group ${targetInboxChatId}`;
  });

  // ── 5. Save inboxGroupId ────────────────────────────────────────────────────
  await conversation.external(() =>
    setGroupSetting(
      selectedSourceGroup.chatId,
      "inboxGroupId",
      targetInboxChatId,
    ),
  );

  // ── 6. Confirm in DM and in the target inbox group ──────────────────────────
  await replyCtx.reply(
    replyCtx.t("setinboxgroup_success", {
      group: escapeHtml(selectedSourceGroup.title),
      inbox: escapeHtml(targetGroupTitle),
      inboxId: String(targetInboxChatId),
    }),
    { parse_mode: "HTML" },
  );

  try {
    const confirmText = replyCtx.t("setinboxgroup_target_confirm", {
      group: escapeHtml(selectedSourceGroup.title),
    });
    await ctx.api.sendMessage(targetInboxChatId, confirmText, {
      parse_mode: "HTML",
    });
  } catch (err: unknown) {
    logger.debug(
      { err, event: "setinboxgroup_confirm_post_failed", targetInboxChatId },
      "Failed to post confirmation to target inbox group",
    );
  }
}

// ── !unsetinboxgroup / /unsetinboxgroup ──────────────────────────────────────

/**
 * Command handler for /unsetinboxgroup and !unsetinboxgroup.
 * Silently drops non-admin invocations.
 * Supports optional direct `<chat_id>` argument or enters the interactive DM selection.
 */
export async function unsetInboxGroupCommand(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  const chat = ctx.chat;
  if (!userId || !chat) return;

  if (chat.type !== "private") {
    const allowed = await isAdminOrOwner(ctx, chat.id, userId);
    if (!allowed) return;
    await ctx.reply(ctx.t("setinboxgroup_dm_only"));
    return;
  }

  const isAnyGroupAdmin = await isUserAnyGroupAdminOrOwner(ctx, userId);
  if (!isAnyGroupAdmin) {
    logger.debug(
      { event: "unsetinboxgroup_non_admin_dropped", userId },
      "Non-admin attempted !unsetinboxgroup in DM — silently dropped",
    );
    return;
  }

  const rawArg = typeof ctx.match === "string" ? ctx.match.trim() : "";
  if (rawArg) {
    const parsedId = parseGroupChatId(rawArg);
    if (parsedId === null) {
      await ctx.reply(ctx.t("setinboxgroup_invalid_target"));
      return;
    }

    const { primaryId: targetChatId } =
      await resolveCandidateGroupIds(parsedId);
    const isAdmin = await isAdminOrOwner(ctx, targetChatId, userId);
    if (!isAdmin) {
      await ctx.reply(ctx.t("error_admin_only"));
      return;
    }

    await setGroupSetting(targetChatId, "inboxGroupId", null);
    const redis = getRedisClient();
    const title =
      (await redis.hget(knownGroupsKey(), String(targetChatId))) ||
      `Group ${targetChatId}`;

    await ctx.reply(
      ctx.t("setinboxgroup_cleared", {
        group: escapeHtml(title),
      }),
      { parse_mode: "HTML" },
    );
    return;
  }

  await ctx.conversation.enter("unsetInboxGroup");
}

/**
 * Conversation registered via createConversation(unsetInboxGroupConversation, { id: "unsetInboxGroup" }).
 */
export async function unsetInboxGroupConversation(
  conversation: InboxGroupConversation,
  ctx: BotContext,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  await ctx.reply(ctx.t("setinboxgroup_checking"));

  const knownGroups = await conversation.external(() => getKnownGroups());
  if (knownGroups.length === 0) {
    await ctx.reply(ctx.t("setinboxgroup_no_groups"));
    return;
  }

  const configuredGroups: Array<{
    chatId: number;
    title: string;
    inboxGroupId: number;
  }> = [];

  for (const { chatId: groupChatId, title } of knownGroups) {
    const isAdmin = await isAdminOrOwner(ctx, groupChatId, userId);
    if (!isAdmin) continue;

    const settings = await conversation.external(() =>
      getGroupSettings(groupChatId),
    );
    if (settings.inboxGroupId !== null && settings.inboxGroupId !== undefined) {
      configuredGroups.push({
        chatId: groupChatId,
        title,
        inboxGroupId: settings.inboxGroupId,
      });
    }
  }

  if (configuredGroups.length === 0) {
    await ctx.reply(ctx.t("unsetinboxgroup_none_configured"));
    return;
  }

  const buttons = configuredGroups.map((g) => [
    {
      text: `${g.title} → ${g.inboxGroupId}`,
      callback_data: `usig:${g.chatId}`,
    },
  ]);
  buttons.push([
    {
      text: getCancelLabel(ctx),
      callback_data: "usig:cancel",
    },
  ]);

  await ctx.reply(ctx.t("unsetinboxgroup_select_group"), {
    reply_markup: { inline_keyboard: buttons },
  });

  const selectionCtx = await conversation.waitForCallbackQuery(/^usig:/);
  const payload = selectionCtx.callbackQuery.data.slice("usig:".length);

  if (payload === "cancel") {
    await selectionCtx.answerCallbackQuery();
    try {
      await selectionCtx.editMessageText(
        selectionCtx.t("setinboxgroup_cancelled"),
      );
    } catch {
      await selectionCtx.reply(selectionCtx.t("setinboxgroup_cancelled"));
    }
    return;
  }

  const selectedChatId = parseInt(payload || "0", 10);
  const selectedGroup = configuredGroups.find(
    (g) => g.chatId === selectedChatId,
  );
  if (!selectedGroup) {
    await selectionCtx.answerCallbackQuery("Invalid selection");
    return;
  }

  await selectionCtx.answerCallbackQuery();

  await conversation.external(() =>
    setGroupSetting(selectedGroup.chatId, "inboxGroupId", null),
  );

  const clearedMsg = selectionCtx.t("setinboxgroup_cleared", {
    group: escapeHtml(selectedGroup.title),
  });

  try {
    await selectionCtx.editMessageText(clearedMsg, { parse_mode: "HTML" });
  } catch {
    await selectionCtx.reply(clearedMsg, { parse_mode: "HTML" });
  }
}
