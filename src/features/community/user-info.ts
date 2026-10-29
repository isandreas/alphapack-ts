import type { BotContext } from "../../types/context.js";
import { getRedisClient } from "../../db/redis.js";
import {
  warnsKey,
  starsKey,
  usernameMapKey,
  globalUsernameMapKey,
} from "../../db/keys.js";
import { isCommandFeatureEnabled } from "../../utils/permissions.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface UserProfileTarget {
  userId: number;
  displayName: string;
  username?: string | undefined;
}

async function resolveUserInfoTarget(
  ctx: BotContext,
  chatId: number,
  argsString: string,
): Promise<{ target: UserProfileTarget | null; explicitFailed: boolean }> {
  const trimmed = argsString.trim();

  // 1. Explicit argument: !user @username or !user 123456789
  if (trimmed) {
    const firstArg = trimmed.split(/\s+/)[0]!;
    let userId: number | null = null;
    let username: string | undefined;

    if (/^\d+$/.test(firstArg)) {
      userId = parseInt(firstArg, 10);
    } else if (firstArg.startsWith("@")) {
      username = firstArg.slice(1).toLowerCase();
      const redis = getRedisClient();
      const idStr =
        (await redis.hget(usernameMapKey(chatId), username)) ??
        (await redis.hget(globalUsernameMapKey(), username));
      if (idStr) {
        userId = parseInt(idStr, 10);
      }
    }

    if (!userId) {
      return { target: null, explicitFailed: true };
    }

    let displayName = username ? `@${username}` : "User";
    try {
      const member = await ctx.api.getChatMember(chatId, userId);
      const fullName = [member.user.first_name, member.user.last_name]
        .filter(Boolean)
        .join(" ");
      if (fullName) {
        displayName = fullName;
      }
      if (member.user.username) {
        username = member.user.username;
      }
    } catch {
      // Fallback to username or "User" if getChatMember fails
    }

    return {
      target: { userId, displayName, username },
      explicitFailed: false,
    };
  }

  // 2. Reply to message: !user
  const replyFrom = ctx.message?.reply_to_message?.from;
  if (replyFrom) {
    const displayName =
      [replyFrom.first_name, replyFrom.last_name].filter(Boolean).join(" ") ||
      "User";
    return {
      target: {
        userId: replyFrom.id,
        displayName,
        username: replyFrom.username,
      },
      explicitFailed: false,
    };
  }

  // 3. Default to sender (self): !user
  if (ctx.from) {
    const displayName =
      [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") ||
      "User";
    return {
      target: {
        userId: ctx.from.id,
        displayName,
        username: ctx.from.username,
      },
      explicitFailed: false,
    };
  }

  return { target: null, explicitFailed: false };
}

/**
 * !user
 * Displays user information (Name, User ID, Username, Warns, Stars) in a group.
 */
export async function userInfoHandler(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  if (ctx.chat.type === "private") {
    await ctx.reply(ctx.t("error_group_only"));
    return;
  }

  if (!isCommandFeatureEnabled(ctx, "user")) {
    return;
  }

  const text = ctx.message?.text ?? ctx.message?.caption ?? "";
  const match = /^\/user(?:@\w+)?\s*/i.exec(text);
  if (!match) return;

  const argsString = text.slice(match[0].length);
  const { target, explicitFailed } = await resolveUserInfoTarget(
    ctx,
    chatId,
    argsString,
  );

  if (explicitFailed || !target) {
    await ctx.reply(ctx.t("error_user_not_found"));
    return;
  }

  const redis = getRedisClient();
  const [rawWarns, rawStars] = await Promise.all([
    redis.hget(warnsKey(chatId), String(target.userId)),
    redis.hget(starsKey(chatId), String(target.userId)),
  ]);

  const warns = Math.max(0, parseInt(rawWarns ?? "0", 10) || 0);
  const stars = Math.max(0, parseInt(rawStars ?? "0", 10) || 0);
  const warnThreshold = ctx.groupSettings?.warnThreshold ?? 5;

  const safeName = escapeHtml(target.displayName);
  const safeUsername = target.username ? `@${escapeHtml(target.username)}` : "-";

  const cardText = ctx.t("user_info_card", {
    name: safeName,
    userId: String(target.userId),
    username: safeUsername,
    warns: String(warns),
    warnThreshold: String(warnThreshold),
    stars: String(stars),
  });

  await ctx.reply(cardText, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

