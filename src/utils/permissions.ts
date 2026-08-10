/**
 * utils/permissions.ts
 *
 * Low-level permission helpers.
 */

import { GrammyError } from "grammy";
import type { User } from "grammy/types";
import type { BotContext } from "../types/context.js";
import { logger } from "./logger.js";
import { isGroupAdmin } from "../middlewares/admin-guard.js";

/**
 * Checks whether userId is an admin or creator in chatId.
 *
 * Makes a live API call every time — prefer isGroupAdmin() from admin-guard.ts
 * which caches the result in Redis.
 *
 * Returns false on any error (conservative deny).
 */
export async function isAdmin(
  ctx: BotContext,
  chatId: number,
  userId: number,
): Promise<boolean> {
  try {
    const member = await ctx.api.getChatMember(chatId, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch (err: unknown) {
    if (err instanceof GrammyError) {
      logger.warn(
        { event: "is_admin_api_error", chatId, userId, code: err.error_code },
        "getChatMember failed — denying admin status",
      );
    } else {
      logger.warn(
        { event: "is_admin_unknown_error", chatId, userId, err },
        "Unexpected error during admin check",
      );
    }
    return false;
  }
}

/**
 * Returns true if the user is a bot (e.g., self or other bot) OR is a group admin/creator.
 * Used for automated moderation exemptions.
 */
export async function isAutoModerationExempt(
  ctx: BotContext,
  chatId: number,
  member: User,
): Promise<boolean> {
  if (member.is_bot) {
    return true;
  }
  return await isGroupAdmin(ctx, chatId, member.id);
}

/**
 * Checks whether a specific moderation feature is enabled in the group settings.
 */
export function isModerationFeatureEnabled(
  ctx: BotContext,
  feature: "warn" | "tban" | "ban" | "mute",
): boolean {
  const settings = ctx.groupSettings;
  if (!settings) return false;
  return settings.moderation?.[feature]?.enabled ?? false;
}
