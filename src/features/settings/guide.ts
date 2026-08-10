import type { BotContext } from "../../types/context.js";
import { replacePlaceholders } from "../../utils/placeholder.js";

/**
 * Handles /guide command in a group.
 * Usable by anyone, group chats only.
 */
export async function guideCommandHandler(ctx: BotContext): Promise<void> {
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

  const guideText = settings.guide?.text;
  if (!guideText) {
    await ctx.reply("ℹ️ The guide has not been set for this group yet.");
    return;
  }

  const groupName = ctx.chat.title || "Group";
  const botName = process.env.BOT_CUSTOM_NAME || ctx.me.first_name;

  const formattedGuide = replacePlaceholders(guideText, {
    groupName,
    botName,
  });

  await ctx.reply(formattedGuide, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: false },
  });
}
