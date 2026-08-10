import type { BotContext } from "../../types/context.js";
import { replacePlaceholders } from "../../utils/placeholder.js";

/**
 * Handles /rules command in a group.
 * Usable by anyone, group chats only.
 */
export async function rulesCommandHandler(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId || ctx.chat?.type === "private") {
    // Silently ignore or show error if private. The spec says "group chats only".
    // Let's reply if in DM since that's user-friendly.
    if (ctx.chat?.type === "private") {
      await ctx.reply("❌ This command can only be used inside groups.");
    }
    return;
  }

  const settings = ctx.groupSettings;
  if (!settings) return;

  const rulesText = settings.rules?.text;
  if (!rulesText) {
    await ctx.reply(ctx.t("rules_not_set"));
    return;
  }

  const groupName = ctx.chat.title || "Group";
  const botName = process.env.BOT_CUSTOM_NAME || ctx.me.first_name;

  const formattedRules = replacePlaceholders(rulesText, {
    groupName,
    botName,
  });

  await ctx.reply(formattedRules, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: false },
  });
}
