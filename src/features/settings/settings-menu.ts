import type { BotContext } from "../../types/context.js";

/**
 * /settings command — DM-only inline menu
 *
 * When called from a group, reply with a DM link button.
 * When called in DM (or via deep-link), show the inline settings menu.
 *
 * TODO (Phase 2):
 *   1. Use @grammyjs/menu to build a rich inline keyboard
 *   2. Menu pages:
 *      - Main: Moderation | Anti-Spam | Welcome | Log Channel
 *      - Moderation: warn threshold, tban duration, delete on warn/mute
 *      - Anti-Spam: flood rate/window, block forwards, block links
 *      - Welcome: enable/disable, auto-delete timer, goodbye toggle
 *      - Log Channel: set/clear channel ID
 *   3. Each toggle/input triggers a Redis HSET on groupSettingsKey
 *   4. Use @grammyjs/conversations for free-text input (e.g. warn threshold value)
 *
 * Architecture note:
 *   The menu is sent in DM to avoid spamming the group with settings messages.
 *   A /settings command in the group replies with a button: "Open Settings ↗"
 *   that deep-links the admin to the bot DM with a ?start=settings_<chatId> payload.
 */
export async function settingsCommandHandler(ctx: BotContext): Promise<void> {
  const chatType = ctx.chat?.type;

  if (chatType === "group" || chatType === "supergroup") {
    // TODO (Phase 2): Build actual deep-link and send InlineKeyboard button
    await ctx.reply(ctx.t("settings.dm_only", { link: "TODO" }), {
      parse_mode: "HTML",
    });
    return;
  }

  // DM context — TODO (Phase 2): render full settings menu
  await ctx.reply(ctx.t("settings.title"), { parse_mode: "HTML" });
}
