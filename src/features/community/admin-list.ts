import type { BotContext } from "../../types/context.js";
import { isCommandFeatureEnabled } from "../../utils/permissions.js";
import { logger } from "../../utils/logger.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getAdminDisplayName(user: {
  first_name: string;
  last_name?: string | undefined;
  username?: string | undefined;
}): string {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (fullName) {
    return escapeHtml(fullName);
  }
  if (user.username) {
    return escapeHtml(user.username);
  }
  return "Admin";
}

/**
 * !adminlist
 * Displays the group's human administrators with the Creator listed first,
 * followed by Administrators using plain display names (no ping).
 */
export async function adminListHandler(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  if (ctx.chat.type === "private") {
    await ctx.reply(ctx.t("error_group_only"));
    return;
  }

  if (!isCommandFeatureEnabled(ctx, "adminlist")) {
    return;
  }

  try {
    const administrators = await ctx.api.getChatAdministrators(chatId);
    const humanAdmins = administrators.filter((member) => !member.user.is_bot);

    const creators = humanAdmins
      .filter((member) => member.status === "creator")
      .map((member) => getAdminDisplayName(member.user));

    const admins = humanAdmins
      .filter((member) => member.status === "administrator")
      .map((member) => getAdminDisplayName(member.user));

    const header = ctx.t("adminlist_header");
    const creatorLabel = ctx.t("adminlist_creator_label");
    const adminsLabel = ctx.t("adminlist_admins_label");
    const noneLabel = ctx.t("adminlist_none");

    const creatorSection =
      creators.length > 0
        ? creators.map((name) => `• ${name}`).join("\n")
        : `• ${noneLabel}`;

    const adminsSection =
      admins.length > 0
        ? admins.map((name) => `• ${name}`).join("\n")
        : `• ${noneLabel}`;

    const replyText = [
      header,
      "",
      creatorLabel,
      creatorSection,
      "",
      adminsLabel,
      adminsSection,
    ].join("\n");

    await ctx.reply(replyText, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (err: unknown) {
    logger.error(
      { err, event: "adminlist_api_error", chatId },
      "Failed to fetch chat administrators for !adminlist",
    );
    await ctx.reply(ctx.t("error_generic"));
  }
}

