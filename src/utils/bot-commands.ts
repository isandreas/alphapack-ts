/**
 * utils/bot-commands.ts
 *
 * Registers scoped bot commands with Telegram via setMyCommands.
 *
 * Scopes:
 *   1. all_group_chats:
 *      Commands visible to regular group members when typing "/" in groups:
 *      - /rules
 *      - /guide
 *      - /ping
 *
 *   2. all_chat_administrators:
 *      Commands visible to group administrators when typing "/" in groups:
 *      - /rules, /guide, /warn, /mute, /ban, /tban, /unmute, /unban, /settings, /ping
 *
 *   3. all_private_chats:
 *      Commands visible in 1-on-1 DMs with the bot:
 *      - /start
 *      - /settings
 *      - /ping
 *
 * Localization:
 *   Registers default (English) commands, plus Indonesian ("id") translations.
 */

import type { Api } from "grammy";
import type { BotCommand } from "grammy/types";
import type { I18n } from "@grammyjs/i18n";
import type { BotContext } from "../types/context.js";
import { logger } from "./logger.js";

export interface CommandDefinition {
  command: string;
  descKey: string;
  fallbackEn: string;
}

export const REGULAR_GROUP_COMMANDS: CommandDefinition[] = [
  { command: "rules", descKey: "cmd_desc_rules", fallbackEn: "Display group rules" },
  { command: "guide", descKey: "cmd_desc_guide", fallbackEn: "Display group guide & links" },
  { command: "ping", descKey: "cmd_desc_ping", fallbackEn: "Check bot latency and status" },
];

export const ADMIN_GROUP_COMMANDS: CommandDefinition[] = [
  { command: "rules", descKey: "cmd_desc_rules", fallbackEn: "Display group rules" },
  { command: "guide", descKey: "cmd_desc_guide", fallbackEn: "Display group guide & links" },
  { command: "warn", descKey: "cmd_desc_warn", fallbackEn: "Warn a member" },
  { command: "mute", descKey: "cmd_desc_mute", fallbackEn: "Mute a member temporarily or permanently" },
  { command: "ban", descKey: "cmd_desc_ban", fallbackEn: "Ban a member permanently" },
  { command: "tban", descKey: "cmd_desc_tban", fallbackEn: "Ban a member temporarily" },
  { command: "unmute", descKey: "cmd_desc_unmute", fallbackEn: "Unmute a muted member" },
  { command: "unban", descKey: "cmd_desc_unban", fallbackEn: "Unban a banned member" },
  { command: "settings", descKey: "cmd_desc_settings", fallbackEn: "Open group settings menu" },
  { command: "ping", descKey: "cmd_desc_ping", fallbackEn: "Check bot latency and status" },
];

export const PRIVATE_CHAT_COMMANDS: CommandDefinition[] = [
  { command: "start", descKey: "cmd_desc_start", fallbackEn: "Start the bot and get info" },
  { command: "settings", descKey: "cmd_desc_settings", fallbackEn: "Open group settings menu" },
  { command: "ping", descKey: "cmd_desc_ping", fallbackEn: "Check bot latency and status" },
];

export function buildBotCommands(
  definitions: CommandDefinition[],
  locale: string,
  i18n?: I18n<BotContext>,
): BotCommand[] {
  return definitions.map(({ command, descKey, fallbackEn }) => {
    let description = fallbackEn;
    if (i18n) {
      try {
        const translated = i18n.t(locale, descKey);
        if (translated && !translated.startsWith("{") && !translated.includes("Missing translation")) {
          description = translated;
        }
      } catch {
        // Fallback to English
      }
    }
    return { command, description };
  });
}

/**
 * Registers all scoped bot commands with Telegram.
 */
export async function registerBotCommands(
  api: Api,
  i18n?: I18n<BotContext>,
): Promise<void> {
  const scopes = [
    {
      scope: { type: "all_group_chats" as const },
      definitions: REGULAR_GROUP_COMMANDS,
    },
    {
      scope: { type: "all_chat_administrators" as const },
      definitions: ADMIN_GROUP_COMMANDS,
    },
    {
      scope: { type: "all_private_chats" as const },
      definitions: PRIVATE_CHAT_COMMANDS,
    },
  ];

  for (const { scope, definitions } of scopes) {
    // 1. Register default (English) commands for this scope
    const defaultCommands = buildBotCommands(definitions, "en", i18n);
    await api.setMyCommands(defaultCommands, { scope });

    // 2. Register Indonesian (id) commands for this scope
    if (i18n) {
      const idCommands = buildBotCommands(definitions, "id", i18n);
      await api.setMyCommands(idCommands, { scope, language_code: "id" });
    }
  }

  logger.info({ event: "bot_commands_registered" }, "Telegram scoped bot commands registered ✓");
}
