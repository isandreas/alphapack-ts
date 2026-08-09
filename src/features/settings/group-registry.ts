/**
 * features/settings/group-registry.ts
 *
 * Lightweight registry of groups the bot is currently in.
 * Tracks {chatId → chatTitle} in a Redis hash.
 *
 * Updated via:
 *   1. my_chat_member events (bot added/removed from groups)
 *   2. Opportunistic upsert on any group message
 */

import type { NextFunction } from "grammy";
import type { BotContext } from "../../types/context.js";
import { getRedisClient } from "../../db/redis.js";
import { knownGroupsKey } from "../../db/keys.js";
import { logger } from "../../utils/logger.js";

/**
 * Returns an array of all known groups: { chatId, title }.
 * Uses an Array instead of a Map because Map is not JSON-serializable,
 * which crashes the grammY conversations replay engine.
 */
export async function getKnownGroups(): Promise<
  Array<{ chatId: number; title: string }>
> {
  const redis = getRedisClient();
  const hash = await redis.hgetall(knownGroupsKey());
  const result: Array<{ chatId: number; title: string }> = [];
  for (const [key, value] of Object.entries(hash)) {
    const chatId = parseInt(key, 10);
    if (!Number.isNaN(chatId)) {
      result.push({ chatId, title: value });
    }
  }
  return result;
}

/**
 * Removes a group from the registry.
 */
export async function removeKnownGroup(chatId: number): Promise<void> {
  const redis = getRedisClient();
  await redis.hdel(knownGroupsKey(), String(chatId));
}

/**
 * Upserts a group into the registry.
 */
export async function upsertKnownGroup(
  chatId: number,
  chatTitle: string,
): Promise<void> {
  const redis = getRedisClient();
  await redis.hset(knownGroupsKey(), String(chatId), chatTitle);
}

/**
 * Middleware: opportunistically upserts the current group into the registry
 * on every group/supergroup message.
 */
export async function groupRegistryMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const chat = ctx.chat;
  if (
    chat &&
    (chat.type === "group" || chat.type === "supergroup") &&
    "title" in chat &&
    chat.title
  ) {
    // Fire-and-forget — don't block the handler pipeline
    upsertKnownGroup(chat.id, chat.title).catch((err) => {
      logger.debug(
        { err, event: "group_registry_upsert_failed", chatId: chat.id },
        "Failed to upsert group in registry",
      );
    });
  }
  await next();
}

/**
 * Handler for my_chat_member events.
 * Tracks when the bot is added to or removed from groups.
 */
export async function myChatMemberHandler(ctx: BotContext): Promise<void> {
  const update = ctx.myChatMember;
  if (!update) return;

  const chat = update.chat;
  const newStatus = update.new_chat_member.status;

  // Only track group/supergroup chats
  if (chat.type !== "group" && chat.type !== "supergroup") return;

  const chatTitle = chat.title || `Group ${chat.id}`;

  if (newStatus === "member" || newStatus === "administrator") {
    await upsertKnownGroup(chat.id, chatTitle);
    logger.info(
      { event: "bot_added_to_group", chatId: chat.id, chatTitle },
      "Bot added to group — registered in group registry",
    );
  } else if (newStatus === "left" || newStatus === "kicked") {
    await removeKnownGroup(chat.id);
    logger.info(
      { event: "bot_removed_from_group", chatId: chat.id, chatTitle },
      "Bot removed from group — unregistered from group registry",
    );
  }
}
