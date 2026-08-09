/**
 * middlewares/admin-guard.ts
 *
 * Admin check with Redis-cached admin list (TTL = 5 min).
 *
 * Why cache?
 * - getChatAdministrators is a Telegram API call (~100–300ms).
 * - Moderation commands are frequent enough that uncached calls would
 *   noticeably slow down every !warn/!mute/!ban invocation.
 * - 5-minute TTL balances freshness (admin promotions/demotions) with cost.
 *
 * Exports:
 *   isGroupAdmin(ctx)   — raw async check, returns boolean
 *   requireAdmin()      — middleware factory: silently drops non-admin updates
 *
 * The raw isGroupAdmin() is exported separately so handlers that need a check
 * but want to reply with a custom error can call it directly instead of
 * installing the middleware factory.
 */

import type { NextFunction } from "grammy";
import type { BotContext } from "../types/context.js";
import { getRedisClient } from "../db/redis.js";
import { adminCacheKey } from "../db/keys.js";
import { logger } from "../utils/logger.js";
import { GrammyError } from "grammy";

/** How long to cache the admin list, in seconds. */
const ADMIN_CACHE_TTL_S = 5 * 60; // 5 minutes

// ── Core check ────────────────────────────────────────────────────────────────

/**
 * Returns true if the user identified by userId is an admin or creator in
 * the given chat.
 *
 * Flow:
 *   1. Check Redis cache for the admin ID list.
 *   2. On cache hit → return userId ∈ cached list.
 *   3. On cache miss → call getChatAdministrators, cache the result with TTL,
 *      then return userId ∈ fresh list.
 *   4. On any error → conservative deny (return false).
 */
export async function getGroupAdmins(
  ctx: BotContext,
  chatId: number,
): Promise<number[]> {
  const redis = getRedisClient();
  const cacheKey = adminCacheKey(chatId);

  // 1. Try cache first
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as number[];
    }
  } catch (err: unknown) {
    logger.warn(
      { event: "admin_cache_read_error", chatId, err },
      "Failed to read admin cache — falling back to API",
    );
  }

  // 2. Cache miss — fetch from Telegram API
  try {
    const administrators = await ctx.api.getChatAdministrators(chatId);
    const adminIds = administrators.map((a: { user: { id: number } }) => a.user.id);

    // 3. Populate cache
    await redis
      .set(cacheKey, JSON.stringify(adminIds), "EX", ADMIN_CACHE_TTL_S)
      .catch((err: unknown) => {
        logger.warn(
          { event: "admin_cache_write_error", chatId, err },
          "Failed to write admin cache",
        );
      });

    return adminIds;
  } catch (err: unknown) {
    if (err instanceof GrammyError) {
      logger.warn(
        { event: "get_admins_api_error", chatId, code: err.error_code },
        "getChatAdministrators failed",
      );
    } else {
      logger.warn(
        { event: "get_admins_unknown_error", chatId, err },
        "Unexpected error checking admin list",
      );
    }
    return [];
  }
}

export async function isGroupAdmin(
  ctx: BotContext,
  chatId: number,
  userId: number,
): Promise<boolean> {
  const adminIds = await getGroupAdmins(ctx, chatId);
  return adminIds.includes(userId);
}

// ── Middleware factory ────────────────────────────────────────────────────────

/**
 * Returns a grammY middleware that silently drops the update if the sender
 * is not an admin in the current group.
 *
 * - Passes through all DM (private) updates without checking — admin guard
 *   is only meaningful in groups.
 * - Silent drop (no reply) prevents leaking information about which commands
 *   are admin-only to non-admin members.
 *
 * Usage:
 *   bot.command("warn", requireAdmin(), warnHandler);
 *
 * Or as a pre-filter for a whole router:
 *   const modRouter = new Composer<BotContext>();
 *   modRouter.use(requireAdmin());
 *   modRouter.command("warn", warnHandler);
 */
export function requireAdmin() {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const chatType = ctx.chat?.type;

    // Always allow in private chats — no admin concept there
    if (!chatId || !userId || chatType === "private") {
      await next();
      return;
    }

    const isAdmin = await isGroupAdmin(ctx, chatId, userId);

    if (!isAdmin) {
      logger.debug(
        { event: "require_admin_denied", chatId, userId },
        "Non-admin attempted an admin-only action — silently dropped",
      );
      return; // Drop: do NOT call next()
    }

    await next();
  };
}
