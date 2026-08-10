/**
 * types/context.ts
 *
 * Extended grammY Context type used throughout the bot.
 *
 * Phase 0 flavor chain:
 *   Context (grammY base)
 *   → SessionFlavor<SessionData>   (minimal session, storage wired in bot.ts)
 *   → I18nFlavor                   (ctx.t() translation helper)
 *   + groupSettings field          (injected by group-settings middleware)
 *
 * Phase 2 additions (NOT here yet — scope creep would be silently wrong):
 *   → ConversationFlavor           (@grammyjs/conversations for multi-step flows)
 *
 * Two-step definition (BaseContext → BotContext) avoids the circular generic
 * that ConversationFlavor<C extends Context> would otherwise create.
 */

import type { Context, SessionFlavor } from "grammy";
import type { I18nFlavor } from "@grammyjs/i18n";
import type { ConversationFlavor } from "@grammyjs/conversations";
import type { GroupSettings } from "./settings.js";

// ── Session Data ───────────────────────────────────────────────────────────────

/**
 * Per-(chat, user) session data stored in Redis.
 * Intentionally minimal for Phase 0 — just the locale override.
 * Phase 2+ will add conversation state here.
 */
export interface SessionData {
  /** User-level locale override (set via /settings DM — Phase 5). */
  locale?: "id" | "en";
  settingsChatId?: number;
  settingsEditState?: {
    chatId: number;
    settingKey: string;
    validation: "text" | "number" | "url" | "template" | "resolution";
    submenu: string;
  };
}

// ── Context ────────────────────────────────────────────────────────────────────

type BaseContext = Context & SessionFlavor<SessionData> & I18nFlavor;

export type BotContext = BaseContext &
  ConversationFlavor<BaseContext> & {
    /**
     * Per-group settings merged from Redis overrides + defaults.yaml.
     * Injected by the group-settings middleware for group/supergroup updates.
     * Undefined in private chat (DM) contexts.
     */
    groupSettings?: GroupSettings;
  };
