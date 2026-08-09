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
  // Pass control to the next middleware immediately so this doesn't block update processing
  next().catch((err) => {
    logger.error({ err, event: "next_middleware_error" }, "Error in middleware chain after username tracker");
  });

  const chatId = ctx.chat?.id;
  const user = ctx.from;

  if (
    chatId &&
    user &&
    user.username &&
    (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup")
  ) {
    try {
      const redis = getRedisClient();
      const key = usernameMapKey(chatId);
      const username = user.username.toLowerCase();

      // We use a pipeline to set the field and ensure a TTL on the whole hash.
      // A 7-day TTL ensures old data expires, but resets every time anyone speaks.
      // This is efficient enough for this scale.
      const pipeline = redis.pipeline();
      pipeline.hset(key, username, user.id.toString());
      pipeline.expire(key, 7 * 24 * 60 * 60); // 7 days
      await pipeline.exec();
    } catch (err: unknown) {
      logger.warn(
        { event: "username_tracker_error", chatId, userId: user.id, username: user.username, err },
        "Failed to track username in Redis",
      );
    }
  }
}
