import type { NextFunction } from "grammy";
import type { BotContext } from "../types/context.js";
import { getRedisClient } from "../db/redis.js";
import { usernameMapKey } from "../db/keys.js";
import { logger } from "../utils/logger.js";

/**
 * Middleware that tracks usernames of users who send messages in groups.
 * This populates a Redis hash mapping `@username` (lowercase) -> `userId`.
 * The mapping has a 7-day TTL since usernames can change.
 *
 * This allows moderation commands (like `/warn @user`) to resolve the target
 * user's ID without needing to reply to their message, as long as they have
 * spoken in the chat recently.
 */
export async function usernameTrackerMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  // Await next so errors propagate properly to bot.catch instead of being swallowed here.
  await next();

  const chatId = ctx.chat?.id;
  const user = ctx.from;

  if (
    chatId &&
    user &&
    user.username &&
    (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup")
  ) {
    // Fire-and-forget only the Redis write — not the entire chain.
    // A failure here is non-critical and should not delay the response.
    const redis = getRedisClient();
    const key = usernameMapKey(chatId);
    const username = user.username.toLowerCase();

    const pipeline = redis.pipeline();
    pipeline.hset(key, username, user.id.toString());
    pipeline.expire(key, 7 * 24 * 60 * 60); // 7 days
    pipeline.exec().catch((err: unknown) => {
      logger.warn(
        { event: "username_tracker_error", chatId, userId: user.id, username: user.username, err },
        "Failed to track username in Redis",
      );
    });
  }
}
