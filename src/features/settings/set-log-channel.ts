/**
 * features/settings/set-log-channel.ts
 *
 * grammY conversation: DM-only flow for admins to configure a group's log channel.
 *
 * Flow:
 *   1. DM-only guard (done in command handler)
 *   2. List groups where user is admin (from group registry)
 *   3. Inline keyboard for group selection
 *   4. Prompt: "Forward a message from your log channel"
 *   5. Validate it's a channel forward
 *   6. Check bot is admin with can_post_messages in that channel
 *   7. Save logChannelId to group settings
 *   8. Confirm in DM + post confirmation to the channel
 */

import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../../types/context.js";
import { getKnownGroups } from "./group-registry.js";
import { isGroupAdmin } from "../../middlewares/admin-guard.js";
import { setGroupSetting } from "../../middlewares/group-settings.js";
import { logger } from "../../utils/logger.js";

type SetLogChannelConversation = Conversation<BotContext, BotContext>;

/**
 * Escapes HTML characters for Telegram's HTML parse mode.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Command handler: guards DM-only, then enters the conversation.
 */
export async function setLogChannelCommand(ctx: BotContext): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply(ctx.t("setlogchannel_dm_only"));
    return;
  }
  await ctx.conversation.enter("setLogChannel");
}

/**
 * The conversation function registered via createConversation().
 */
export async function setLogChannelConversation(
  conversation: SetLogChannelConversation,
  ctx: BotContext,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  // ── 1. Send "checking" message ────────────────────────────────────────────
  await ctx.reply(ctx.t("setlogchannel_checking"));

  // ── 2. Find groups where user is admin ────────────────────────────────────
  const knownGroups = await conversation.external(() => getKnownGroups());

  if (knownGroups.length === 0) {
    await ctx.reply(ctx.t("setlogchannel_no_groups"));
    return;
  }

  const adminGroups: Array<{ chatId: number; title: string }> = [];
  for (const { chatId: groupChatId, title } of knownGroups) {
    // Note: isGroupAdmin uses ctx.api.getChatAdministrators under the hood.
    // Do NOT wrap in conversation.external because Bot API calls are forbidden inside external.
    const isAdmin = await isGroupAdmin(ctx, groupChatId, userId);
    if (isAdmin) adminGroups.push({ chatId: groupChatId, title });
  }

  if (adminGroups.length === 0) {
    await ctx.reply(ctx.t("setlogchannel_no_groups"));
    return;
  }

  // ── 3. Present group selection keyboard ───────────────────────────────────
  const keyboard = {
    inline_keyboard: adminGroups.map((g) => [
      { text: g.title, callback_data: `slc:${g.chatId}` },
    ]),
  };

  await ctx.reply(ctx.t("setlogchannel_select_group"), {
    reply_markup: keyboard,
  });

  // Wait for group selection callback
  const selectionCtx = await conversation.waitForCallbackQuery(/^slc:/);
  const selectedChatId = parseInt(
    selectionCtx.callbackQuery.data.split(":")[1] || "0",
    10,
  );

  const selectedGroup = adminGroups.find((g) => g.chatId === selectedChatId);
  if (!selectedGroup) {
    await selectionCtx.answerCallbackQuery("Invalid selection");
    return;
  }

  await selectionCtx.answerCallbackQuery();

  // ── 4. Prompt for channel forward ─────────────────────────────────────────
  await selectionCtx.reply(
    selectionCtx.t("setlogchannel_forward_prompt", {
      group: escapeHtml(selectedGroup.title),
    }),
    { parse_mode: "HTML" },
  );

  // Loop until we get a valid channel forward
  let channelId: number | null = null;

  while (channelId === null) {
    const forwardCtx = await conversation.waitFor("message");
    const msg = forwardCtx.message;

    if (!msg) {
      await forwardCtx.reply(forwardCtx.t("setlogchannel_not_channel_forward"));
      continue;
    }

    let forwardedChannelId: number | null = null;

    if (
      msg.forward_origin &&
      msg.forward_origin.type === "channel" &&
      msg.forward_origin.chat
    ) {
      forwardedChannelId = msg.forward_origin.chat.id;
    } else {
      const rawMsg = msg as unknown as Record<string, unknown>;
      const ffc = rawMsg["forward_from_chat"] as
        | { type: string; id: number }
        | undefined;
      if (ffc && ffc.type === "channel") {
        forwardedChannelId = ffc.id;
      }
    }

    if (!forwardedChannelId) {
      await forwardCtx.reply(forwardCtx.t("setlogchannel_not_channel_forward"));
      continue;
    }

    // ── 5. Verify bot is admin with can_post_messages ─────────────────────
    const capturedChannelId = forwardedChannelId;
    const botId = ctx.me.id;

    let permissionOk = false;
    try {
      // Do NOT wrap in conversation.external because Bot API calls are forbidden inside external.
      const member = await ctx.api.getChatMember(capturedChannelId, botId);
      permissionOk =
        member.status === "administrator" &&
        "can_post_messages" in member &&
        !!member.can_post_messages;
    } catch (err: unknown) {
      logger.debug(
        { err, event: "setlogchannel_bot_check_failed" },
        "Failed to check bot membership in channel",
      );
      permissionOk = false;
    }

    if (!permissionOk) {
      await forwardCtx.reply(forwardCtx.t("setlogchannel_bot_not_admin"));
      return;
    }

    channelId = capturedChannelId;
  }

  // ── 6. Save logChannelId ──────────────────────────────────────────────────
  await conversation.external(() =>
    setGroupSetting(selectedGroup.chatId, "logChannelId", channelId!),
  );

  // ── 7. Confirm in DM ─────────────────────────────────────────────────────
  await ctx.reply(
    ctx.t("setlogchannel_success", {
      group: escapeHtml(selectedGroup.title),
    }),
    { parse_mode: "HTML" },
  );

  // Post confirmation to the channel itself
  try {
    const confirmText = ctx.t("setlogchannel_channel_confirm", {
      group: escapeHtml(selectedGroup.title),
    });
    await ctx.api.sendMessage(channelId!, confirmText);
  } catch (err: unknown) {
    logger.debug(
      { err, event: "setlogchannel_confirm_post_failed" },
      "Failed to post confirmation to log channel",
    );
  }
}
