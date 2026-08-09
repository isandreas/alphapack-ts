/**
 * middlewares/command-parser.ts
 *
 * Normalises the "!" command prefix to "/" so that all grammY command handlers
 * registered with bot.command() fire identically for both prefixes.
 *
 * How it works
 * ─────────────
 * grammY's command parser only recognises messages starting with "/".
 * This middleware intercepts messages starting with "!" and rewrites the text
 * in-place (on the update object) before grammY's built-in routing sees it.
 *
 * Examples:
 *   "!ping"           → "/ping"
 *   "!warn @user"     → "/warn @user"
 *   "!ban 10m"        → "/ban 10m"
 *   "/ping"           → unchanged
 *   "hello!"          → unchanged (! not at start)
 *   "!   ping"        → unchanged (! must be immediately followed by word char)
 *
 * This is generic — no per-command wiring is needed. Every future command
 * registered with bot.command("x") will automatically work with "!x" for free.
 *
 * Installation: must be the FIRST middleware in the chain, before session,
 * i18n, and any command handlers.
 *
 *   bot.use(commandParserMiddleware);
 */

import type { NextFunction } from "grammy";
import type { BotContext } from "../types/context.js";

/**
 * Regex: matches a message that starts with "!" immediately followed by
 * one or more word characters (letters, digits, underscore).
 * The "!" must be at the very beginning of the string.
 */
const BANG_CMD_RE = /^!(\w[\w]*)(\s.*)?$/s;

export async function commandParserMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const msg = ctx.message;
  if (!msg) {
    await next();
    return;
  }

  // Process both text messages and captions (e.g., "!warn" on a photo)
  const text = msg.text ?? msg.caption;

  if (text) {
    const match = BANG_CMD_RE.exec(text);
    if (match) {
      const command = match[1]!;          // e.g. "ping"
      const rest = match[2] ?? "";        // e.g. " @user reason" or ""
      const rewritten = `/${command}${rest}`;

      if (msg.text !== undefined) {
        msg.text = rewritten;
        msg.entities = msg.entities ?? [];
        msg.entities.push({
          type: "bot_command",
          offset: 0,
          length: command.length + 1,
        });
      }
      if (msg.caption !== undefined) {
        msg.caption = rewritten;
        msg.caption_entities = msg.caption_entities ?? [];
        msg.caption_entities.push({
          type: "bot_command",
          offset: 0,
          length: command.length + 1,
        });
      }
    }
  }

  await next();
}
