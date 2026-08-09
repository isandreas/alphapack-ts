import type { BotContext } from "../../types/context.js";
import { setGroupSetting } from "../../middlewares/group-settings.js";

/**
 * Validate that placeholders in a template are well-formed and only use allowed ones.
 * Returns an error string if invalid, or null if valid.
 */
export function validateTemplate(template: string): string | null {
  const allowed = ["first_name", "group_name", "username", "mention"];
  const regex = /\{([^}]+)\}/g;
  let match;

  // Check for unmatched braces
  let openBraces = 0;
  for (const char of template) {
    if (char === "{") openBraces++;
    if (char === "}") {
      openBraces--;
      if (openBraces < 0) {
        return "Unmatched closing brace '}' found.";
      }
    }
  }
  if (openBraces > 0) {
    return "Unmatched opening brace '{' found.";
  }

  while ((match = regex.exec(template)) !== null) {
    const placeholder = match[1];
    if (!allowed.includes(placeholder)) {
      return `Invalid placeholder: {${placeholder}}. Only {first_name}, {group_name}, {username}, and {mention} are allowed.`;
    }
  }
  return null;
}

export async function welcomeToggleCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const match = /^\/welcome\s+(on|off)/i.exec(text);
  if (!match) {
    await ctx.reply("⚠️ Usage: /welcome on|off");
    return;
  }

  const enabled = match[1].toLowerCase() === "on";
  await setGroupSetting(chatId, "welcome.enabled", enabled);

  await ctx.reply(enabled ? "✅ Welcome messages enabled." : "✅ Welcome messages disabled.");
}

export async function setWelcomeCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const prefixLen = /^\/setwelcome\s+/i.exec(text)?.[0].length ?? 0;
  if (prefixLen === 0) {
    await ctx.reply("⚠️ Usage: /setwelcome <template>");
    return;
  }

  const template = text.substring(prefixLen).trim();
  if (!template) {
    await ctx.reply("⚠️ Usage: /setwelcome <template>");
    return;
  }

  const validationError = validateTemplate(template);
  if (validationError) {
    await ctx.reply(`❌ Invalid template: ${validationError}`);
    return;
  }

  await setGroupSetting(chatId, "welcome.template", template);
  await ctx.reply("✅ Welcome template updated.");
}

export async function goodbyeToggleCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const match = /^\/goodbye\s+(on|off)/i.exec(text);
  if (!match) {
    await ctx.reply("⚠️ Usage: /goodbye on|off");
    return;
  }

  const enabled = match[1].toLowerCase() === "on";
  await setGroupSetting(chatId, "goodbye.enabled", enabled);

  await ctx.reply(enabled ? "✅ Goodbye messages enabled." : "✅ Goodbye messages disabled.");
}

export async function setGoodbyeCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const prefixLen = /^\/setgoodbye\s+/i.exec(text)?.[0].length ?? 0;
  if (prefixLen === 0) {
    await ctx.reply("⚠️ Usage: /setgoodbye <template>");
    return;
  }

  const template = text.substring(prefixLen).trim();
  if (!template) {
    await ctx.reply("⚠️ Usage: /setgoodbye <template>");
    return;
  }

  const validationError = validateTemplate(template);
  if (validationError) {
    await ctx.reply(`❌ Invalid template: ${validationError}`);
    return;
  }

  await setGroupSetting(chatId, "goodbye.template", template);
  await ctx.reply("✅ Goodbye template updated.");
}

export async function captchaToggleCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const match = /^\/captcha\s+(on|off)/i.exec(text);
  if (!match) {
    await ctx.reply("⚠️ Usage: /captcha on|off");
    return;
  }

  const enabled = match[1].toLowerCase() === "on";
  await setGroupSetting(chatId, "welcome.captcha.enabled", enabled);

  await ctx.reply(enabled ? "✅ Captcha gate enabled." : "✅ Captcha gate disabled.");
}
