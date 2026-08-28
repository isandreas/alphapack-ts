import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../../types/context.js";
import { setGroupSetting } from "../../middlewares/group-settings.js";

type SettingsConversation = Conversation<BotContext, BotContext>;

const TEMPLATE_KEYS_HELP =
  `<b>Available keys:</b>\n` +
  `<code>{user_displayname}</code> — clickable mention link\n` +
  `<code>{user_id}</code> — Telegram user ID\n` +
  `<code>{user_username}</code> — @username or first name\n` +
  `<code>{group_name}</code> — group title\n` +
  `<code>{bot_name}</code> — bot display name`;

const ALLOWED_PLACEHOLDERS = [
  // Canonical keys
  "user_displayname", "user_id", "user_username",
  "group_name", "bot_name",
  // Legacy aliases kept for backwards compatibility
  "mention", "first_name", "username",
];

/**
 * Generic conversation to edit settings text, numbers, or templates.
 *
 * IMPORTANT: grammY conversations v2 replays the conversation function on every
 * incoming message. During replay, ctx.session is undefined because session
 * middleware is not re-run. All external/mutable state MUST be read via
 * conversation.external() so the value is captured once during real execution
 * and stored in the conversation log for replay.
 */
export async function settingsEditorConversation(
  conversation: SettingsConversation,
  ctx: BotContext,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply("❌ Unable to identify user.");
    return;
  }

  // ✅ Safe: external() captures this value once during real execution.
  const stateStr = await conversation.external(async () => {
    const { getRedisClient } = await import("../../db/redis.js");
    const { settingsEditKey } = await import("../../db/keys.js");
    const redis = getRedisClient();
    return redis.get(settingsEditKey(userId));
  });

  if (!stateStr) {
    await ctx.reply("❌ No active edit session found.");
    return;
  }

  const state = JSON.parse(stateStr);
  const { chatId, settingKey, validation } = state;

  const promptMsg = validation === "template"
    ? `✏️ Send the new template for <b>${settingKey}</b>:\n\n${TEMPLATE_KEYS_HELP}\n\nSend /cancel to abort.`
    : `✏️ Please enter the new value for <b>${settingKey}</b>:\n\nSend /cancel to abort.`;

  await ctx.reply(promptMsg, { parse_mode: "HTML" });

  let value: string | number | null = null;
  let cancelled = false;

  while (true) {
    const nextCtx = await conversation.waitFor("message:text");
    const text = nextCtx.message.text?.trim();

    if (text === "/cancel") {
      await nextCtx.reply("❌ Editing cancelled.");
      cancelled = true;
      break;
    }

    if (!text) {
      await nextCtx.reply("❌ Please enter a valid value:");
      continue;
    }

    if (validation === "number") {
      const num = parseInt(text, 10);
      if (isNaN(num) || num <= 0) {
        await nextCtx.reply("❌ Please enter a positive integer:");
        continue;
      }
      value = num;
      await nextCtx.reply("✅ Value saved!");
      break;

    } else if (validation === "url") {
      if (!text.startsWith("http://") && !text.startsWith("https://")) {
        await nextCtx.reply("❌ Please enter a valid URL (starting with http:// or https://):");
        continue;
      }
      value = text;
      await nextCtx.reply("✅ URL saved!");
      break;

    } else if (validation === "template") {
      const matches = text.match(/{([^}]+)}/g) || [];
      let ok = true;
      for (const m of matches) {
        const placeholder = m.slice(1, -1);
        if (!ALLOWED_PLACEHOLDERS.includes(placeholder)) {
          await nextCtx.reply(
            `❌ Unknown placeholder <code>{${placeholder}}</code>.\n\n${TEMPLATE_KEYS_HELP}\n\nPlease try again or send /cancel:`,
            { parse_mode: "HTML" }
          );
          ok = false;
          break;
        }
      }
      if (ok) {
        value = text;
        await nextCtx.reply("✅ Template saved!");
        break;
      }

    } else {
      value = text;
      await nextCtx.reply("✅ Value saved!");
      break;
    }
  }

  if (cancelled || value === null) return;

  // ✅ Safe: setGroupSetting talks to Redis — must run via external().
  await conversation.external(() => setGroupSetting(chatId, settingKey, value!));

  // We cannot send a grammY Menu from inside a conversation (no middleware chain).
  // Just confirm and tell the admin to reopen settings.
  await ctx.reply("✅ Setting saved! Use /settings to return to the panel.");
}


