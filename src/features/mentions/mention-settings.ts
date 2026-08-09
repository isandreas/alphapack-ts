import type { BotContext } from "../../types/context.js";
import { setGroupSetting } from "../../middlewares/group-settings.js";

export async function adminMentionToggleCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const match = /^\/adminmention\s+(on|off)/i.exec(text);
  if (!match) {
    await ctx.reply("⚠️ Usage: /adminmention on|off");
    return;
  }

  const enabled = match[1].toLowerCase() === "on";
  await setGroupSetting(chatId, "mentions.adminRelay.enabled", enabled);

  await ctx.reply(enabled ? "✅ @admin relay enabled." : "✅ @admin relay disabled.");
}

export async function mentionNotifyToggleCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const match = /^\/mentionnotify\s+(on|off)/i.exec(text);
  if (!match) {
    await ctx.reply("⚠️ Usage: /mentionnotify on|off");
    return;
  }

  const enabled = match[1].toLowerCase() === "on";
  await setGroupSetting(chatId, "mentions.userNotify.enabled", enabled);

  await ctx.reply(enabled ? "✅ Mention notifications enabled." : "✅ Mention notifications disabled.");
}
