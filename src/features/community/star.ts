import type { BotContext } from "../../types/context.js";
import { getRedisClient } from "../../db/redis.js";
import { starsKey, usernameMapKey, globalUsernameMapKey } from "../../db/keys.js";
import { formatUserMention } from "../../utils/target-resolver.js";
import { isCommandFeatureEnabled } from "../../utils/permissions.js";

const STAR_DELTA_RE = /^([+-])(\d+)$/;

interface ResolvedStarTarget {
  userId: number;
  username?: string | undefined;
  displayName: string;
  delta: number;
}

async function resolveStarTarget(
  ctx: BotContext,
  chatId: number,
  argsString: string,
): Promise<ResolvedStarTarget | null> {
  const trimmed = argsString.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  const replyFrom = ctx.message?.reply_to_message?.from;

  // Case 1: Reply mode — `!star +1` or `!star -2`
  if (replyFrom && parts.length >= 1) {
    const deltaMatch = STAR_DELTA_RE.exec(parts[0]!);
    if (deltaMatch) {
      const sign = deltaMatch[1] === "-" ? -1 : 1;
      const amount = parseInt(deltaMatch[2]!, 10);
      if (amount <= 0) return null;

      const displayName =
        [replyFrom.first_name, replyFrom.last_name].filter(Boolean).join(" ") ||
        "User";

      return {
        userId: replyFrom.id,
        username: replyFrom.username,
        displayName,
        delta: sign * amount,
      };
    }
  }

  // Case 2: Explicit target mode — `!star @username +1` or `!star 123456 -2`
  if (parts.length < 2) return null;

  const targetArg = parts[0]!;
  const deltaArg = parts[1]!;
  const deltaMatch = STAR_DELTA_RE.exec(deltaArg);
  if (!deltaMatch) return null;

  const sign = deltaMatch[1] === "-" ? -1 : 1;
  const amount = parseInt(deltaMatch[2]!, 10);
  if (amount <= 0) return null;

  let userId: number | null = null;
  let username: string | undefined;

  if (/^\d+$/.test(targetArg)) {
    userId = parseInt(targetArg, 10);
  } else if (targetArg.startsWith("@")) {
    username = targetArg.slice(1).toLowerCase();
    const redis = getRedisClient();
    const idStr =
      (await redis.hget(usernameMapKey(chatId), username)) ??
      (await redis.hget(globalUsernameMapKey(), username));
    if (idStr) {
      userId = parseInt(idStr, 10);
    }
  }

  if (!userId) return null;

  let displayName = "User";
  try {
    const member = await ctx.api.getChatMember(chatId, userId);
    displayName =
      [member.user.first_name, member.user.last_name].filter(Boolean).join(" ") ||
      "User";
    if (!username && member.user.username) {
      username = member.user.username;
    }
  } catch {
    // Fallback to username or "User" if getChatMember fails
  }

  return {
    userId,
    username,
    displayName,
    delta: sign * amount,
  };
}

/**
 * !star (+[n] or -[n])
 * Admin-only group command to increment/decrement a user's stars.
 */
export async function starHandler(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const adminId = ctx.from?.id;
  if (!chatId || !adminId) return;

  if (ctx.chat.type === "private") {
    await ctx.reply(ctx.t("error_group_only"));
    return;
  }

  if (!isCommandFeatureEnabled(ctx, "star")) {
    return;
  }

  const text = ctx.message?.text ?? ctx.message?.caption ?? "";
  const match = /^\/star(?:@\w+)?\s*/i.exec(text);
  if (!match) return;

  const argsString = text.slice(match[0].length);
  const resolved = await resolveStarTarget(ctx, chatId, argsString);

  if (!resolved) {
    await ctx.reply(ctx.t("usage_star"));
    return;
  }

  const redis = getRedisClient();
  const key = starsKey(chatId);
  let newStars = await redis.hincrby(key, String(resolved.userId), resolved.delta);

  if (newStars < 0) {
    newStars = 0;
    await redis.hset(key, String(resolved.userId), "0");
  }

  const changeStr = resolved.delta > 0 ? `+${resolved.delta}` : `${resolved.delta}`;
  const targetMention = formatUserMention(
    resolved.userId,
    resolved.displayName,
    resolved.username,
  );

  const replyText = ctx
    .t("reply_star_updated", {
      target: "TARGET_PLACEHOLDER",
      change: changeStr,
      stars: String(newStars),
    })
    .replace("TARGET_PLACEHOLDER", targetMention);

  await ctx.reply(replyText, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

