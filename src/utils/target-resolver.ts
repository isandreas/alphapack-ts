import type { BotContext } from "../types/context.js";
import { getRedisClient } from "../db/redis.js";
import { usernameMapKey } from "../db/keys.js";
import { parseDuration } from "./time-parser.js";

export interface TargetResolution {
  userId: number;
  username?: string | undefined;
  displayName?: string | undefined;
  reason: string;
}

export interface TargetResolutionWithDuration extends TargetResolution {
  durationSeconds: number;
}

/**
 * Resolves the target of a moderation command (e.g. /warn, /ban).
 * Supports:
 *   - Replying to a message: `/warn <reason>`
 *   - Explicit ID: `/warn 123456789 <reason>`
 *   - Explicit @username: `/warn @user <reason>`
 *
 * @param ctx The context
 * @param text The full message text
 * @param commandLength The length of the command (e.g. 5 for "/warn")
 * @returns The resolved target, or null if resolution fails
 */
export async function resolveTarget(
  ctx: BotContext,
  text: string,
  commandLength: number,
): Promise<TargetResolution | null> {
  const argsString = text.slice(commandLength).trim();
  const replyTo = ctx.message?.reply_to_message;

  if (replyTo && replyTo.from) {
    const name = [replyTo.from.first_name, replyTo.from.last_name].filter(Boolean).join(" ");
    // Resolved via reply. The entire arguments string is the reason.
    return {
      userId: replyTo.from.id,
      username: replyTo.from.username,
      displayName: name || "User",
      reason: argsString,
    };
  }

  // Resolved via explicit argument
  if (!argsString) return null; // No reply, no arguments

  const firstArgEnd = argsString.indexOf(" ");
  const firstArg = firstArgEnd === -1 ? argsString : argsString.slice(0, firstArgEnd);
  const reason = firstArgEnd === -1 ? "" : argsString.slice(firstArgEnd + 1).trim();

  let userId: number | null = null;
  let username: string | undefined = undefined;

  // Is it a numeric ID?
  if (/^\d+$/.test(firstArg)) {
    userId = parseInt(firstArg, 10);
  } else if (firstArg.startsWith("@")) {
    // Is it a @username?
    const chatId = ctx.chat?.id;
    if (!chatId) return null;

    username = firstArg.slice(1).toLowerCase();
    const redis = getRedisClient();
    const idStr = await redis.hget(usernameMapKey(chatId), username);

    if (idStr) {
      userId = parseInt(idStr, 10);
    }
  }

  if (!userId) return null;

  let displayName = "User";
  if (ctx.chat?.id) {
    try {
      const member = await ctx.api.getChatMember(ctx.chat.id, userId);
      displayName = [member.user.first_name, member.user.last_name].filter(Boolean).join(" ") || "User";
    } catch (e) {
      // ignore
    }
  }

  return {
    userId,
    username,
    displayName,
    reason,
  };
}

/**
 * Resolves a target AND a duration argument (e.g. for /mute, /tban).
 * Supports:
 *   - Replying to a message: `/mute 1h <reason>`
 *   - Explicit ID/username: `/mute @user 1h <reason>`
 */
export async function resolveTargetWithDuration(
  ctx: BotContext,
  text: string,
  commandLength: number,
  requireDuration: boolean = false
): Promise<TargetResolutionWithDuration | null> {
  const argsString = text.slice(commandLength).trim();
  const replyTo = ctx.message?.reply_to_message;

  if (replyTo && replyTo.from) {
    // Arguments: [duration] [reason...]
    const firstArgEnd = argsString.indexOf(" ");
    const firstArg = firstArgEnd === -1 ? argsString : argsString.slice(0, firstArgEnd);
    const reason = firstArgEnd === -1 ? "" : argsString.slice(firstArgEnd + 1).trim();

    let durationSeconds = 0;
    let actualReason = argsString;

    if (firstArg) {
      const parsed = parseDuration(firstArg);
      if (parsed !== null) {
        durationSeconds = parsed;
        actualReason = reason;
      } else if (requireDuration) {
        return null; // Duration required but invalid
      }
    } else if (requireDuration) {
      return null;
    }

    const name = [replyTo.from.first_name, replyTo.from.last_name].filter(Boolean).join(" ");

    return {
      userId: replyTo.from.id,
      username: replyTo.from.username,
      displayName: name || "User",
      reason: actualReason,
      durationSeconds,
    };
  }

  // No reply. Arguments: [target] [duration] [reason...]
  if (!argsString) return null;

  const parts = argsString.split(/\s+/);
  if (parts.length === 0) return null;

  const targetArg = parts[0]!;
  let durationSeconds = 0;
  let reasonIndex = 1;

  if (parts.length > 1) {
    const parsed = parseDuration(parts[1]!);
    if (parsed !== null) {
      durationSeconds = parsed;
      reasonIndex = 2;
    } else if (requireDuration) {
      return null;
    }
  } else if (requireDuration) {
    return null;
  }

  const reason = parts.slice(reasonIndex).join(" ").trim();
  const chatId = ctx.chat?.id;

  let userId: number | null = null;
  let username: string | undefined = undefined;

  if (/^\d+$/.test(targetArg)) {
    userId = parseInt(targetArg, 10);
  } else if (targetArg.startsWith("@") && chatId) {
    username = targetArg.slice(1).toLowerCase();
    const redis = getRedisClient();
    const idStr = await redis.hget(usernameMapKey(chatId), username);
    if (idStr) {
      userId = parseInt(idStr, 10);
    }
  }

  if (userId === null) return null;

  let memberName = "User";
  if (chatId) {
    try {
      const member = await ctx.api.getChatMember(chatId, userId);
      memberName = [member.user.first_name, member.user.last_name].filter(Boolean).join(" ") || "User";
    } catch (e) {
      // ignore
    }
  }

  return {
    userId,
    username,
    displayName: memberName,
    reason,
    durationSeconds,
  };
}

/**
 * Helper to format user as a clickable link: "Display Name [ID]"
 */
export function formatUserMention(
  userId: number,
  displayName: string = "User",
  username?: string,
): string {
  const name =
    displayName && displayName !== "User"
      ? displayName
      : username
      ? `@${username}`
      : "User";
  const safeName = name
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<a href="tg://user?id=${userId}">${safeName} [${userId}]</a>`;
}
