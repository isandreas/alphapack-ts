/**
 * middlewares/admin-guard.ts
 *
 * Live Telegram administrator check via getChatAdministrators.
 *
 * Exports:
 *   getGroupAdmins(ctx, chatId)          — returns admin user IDs from Telegram API
 *   isGroupAdmin(ctx, chatId, userId)    — returns true if userId is admin/creator
 *   requireAdmin()                       — middleware factory: silently drops non-admin updates
 */

import type { NextFunction } from "grammy";
import { GrammyError } from "grammy";
import type { BotContext } from "../types/context.js";
import { migrateGroupInRedis } from "../features/settings/group-registry.js";
import { logger } from "../utils/logger.js";

// ── Core check ────────────────────────────────────────────────────────────────

/**
 * Returns the list of administrator and creator user IDs for the given chat
 * directly from Telegram's getChatAdministrators API.
 *
 * Automatically handles basic group → supergroup migration redirects
 * (`migrate_to_chat_id`). On any other error, returns an empty array
 * (conservative deny).
 */
export async function getGroupAdmins(
  ctx: BotContext,
  chatId: number,
): Promise<number[]> {
  try {
    const administrators = await ctx.api.getChatAdministrators(chatId);
    return administrators.map((a: { user: { id: number } }) => a.user.id);
  } catch (err: unknown) {
    if (err instanceof GrammyError) {
      const migratedId = err.parameters?.migrate_to_chat_id;
      if (typeof migratedId === "number" && migratedId !== chatId) {
        await migrateGroupInRedis(chatId, migratedId).catch(() => {});
        try {
          const administrators = await ctx.api.getChatAdministrators(migratedId);
          return administrators.map((a: { user: { id: number } }) => a.user.id);
        } catch {
          return [];
        }
      }
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
