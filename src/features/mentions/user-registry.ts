import type { NextFunction } from "grammy";
import type { BotContext } from "../../types/context.js";
import { getRedisClient } from "../../db/redis.js";
import { globalUsernameMapKey, startedUsersKey } from "../../db/keys.js";
import { logger } from "../../utils/logger.js";

/**
 * Middleware that populates the global username registry and the started users set.
 * Runs on every update.
 */
export async function userRegistryMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const user = ctx.from;
  if (user) {
    const redis = getRedisClient();

    // 1. Track username mapping
    if (user.username) {
      try {
        const usernameKey = globalUsernameMapKey();
        await redis.hset(usernameKey, user.username.toLowerCase(), user.id.toString());
      } catch (err: unknown) {
        logger.warn(
          { event: "user_registry_track_failed", userId: user.id, username: user.username, err },
          "Failed to track username in global registry",
        );
      }
    }

    // 2. Track if user has started DM with the bot.
    // We register their started state when they communicate in a private chat.
    if (ctx.chat?.type === "private") {
      try {
        const startedKey = startedUsersKey();
        await redis.sadd(startedKey, user.id.toString());
      } catch (err: unknown) {
        logger.warn(
          { event: "user_registry_started_failed", userId: user.id, err },
          "Failed to track user started status in set",
        );
      }
    }
  }

  await next();
}

/**
 * Resolves a username (case-insensitive) to a user ID.
 * Returns null if not found in the global registry.
 */
export async function resolveUsername(username: string): Promise<number | null> {
  const redis = getRedisClient();
  try {
    const idStr = await redis.hget(globalUsernameMapKey(), username.toLowerCase());
    return idStr ? parseInt(idStr, 10) : null;
  } catch (err: unknown) {
    logger.warn({ event: "resolve_username_failed", username, err }, "Failed to resolve username from registry");
    return null;
  }
}

/**
 * Returns true if the user is verified to have started a DM with the bot.
 */
export async function hasStartedBot(userId: number): Promise<boolean> {
  const redis = getRedisClient();
  try {
    const res = await redis.sismember(startedUsersKey(), userId.toString());
    return res === 1;
  } catch (err: unknown) {
    logger.warn({ event: "check_started_bot_failed", userId, err }, "Failed to check started bot set");
    return false;
  }
}
