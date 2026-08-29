/**
 * features/moderation/alphabet-filter.ts
 *
 * Phase 6 — Alphabet / script filter middleware.
 *
 * Scans new group messages (text AND captions) for characters from Unicode
 * script ranges that have been toggled as "restricted" in the group's settings.
 * Any single matching character triggers an immediate delete + kick via the
 * shared applyRestrictionPunishment helper.
 *
 * Unicode ranges used (plain regex, no external library — lightweight for the
 * VPS memory budget):
 *
 *   Script       | Range(s)
 *   -------------|--------------------------------------------------
 *   Cyrillic     | \u0400-\u04FF
 *   Arabic       | \u0600-\u06FF  (core) + \u0750-\u077F (supplement)
 *   CJK          | \u4E00-\u9FFF (Han) | \u3040-\u30FF (Hiragana/Katakana)
 *                |               | \uAC00-\uD7A3 (Hangul)
 *   Thai         | \u0E00-\u0E7F
 *   Hebrew       | \u0590-\u05FF
 *   Devanagari   | \u0900-\u097F
 *
 * Out of scope for this pass (flagged for future review):
 *   - edited_message scanning: a user could post clean text then edit in
 *     restricted script to evade the filter. Worth closing in a later pass.
 *   - Percentage/majority threshold — per spec, ANY single character is enough.
 */

import type { NextFunction } from "grammy";
import type { BotContext } from "../../types/context.js";
import { isAutoModerationExempt } from "../../utils/permissions.js";
import { applyRestrictionPunishment } from "./restriction-punishment.js";
import { logger } from "../../utils/logger.js";

// ── Script regex map ──────────────────────────────────────────────────────────
// Compiled once at module load — not per-request. Each regex tests for the
// presence of AT LEAST ONE character from that script (no threshold logic).

const SCRIPT_REGEXES: Record<
  keyof NonNullable<BotContext["groupSettings"]>["alphabetFilter"],
  RegExp
> = {
  cyrillic: /[\u0400-\u04FF]/,
  arabic: /[\u0600-\u06FF\u0750-\u077F]/,
  /** Han, Hiragana/Katakana, or Hangul — any one of these counts as CJK. */
  cjk: /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7A3]/,
  thai: /[\u0E00-\u0E7F]/,
  hebrew: /[\u0590-\u05FF]/,
  devanagari: /[\u0900-\u097F]/,
};

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Alphabet filter middleware (Phase 6).
 *
 * Install in bot.ts after floodGuardMiddleware but before command handlers.
 * Runs only on new messages in group/supergroup chats.
 */
export async function alphabetFilterMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;

  // 1. Only run in group/supergroup chats on actual messages
  if (!chatId || !userId || ctx.chat?.type === "private") {
    return next();
  }

  if (!ctx.message) {
    return next();
  }

  // Skip system service messages
  const msg = ctx.message;
  if (
    msg.new_chat_members ||
    msg.left_chat_member ||
    msg.pinned_message ||
    msg.group_chat_created ||
    msg.supergroup_chat_created
  ) {
    return next();
  }

  // 2. Admins and bots are fully exempt — same policy as flood-guard & captcha
  const isExempt = await isAutoModerationExempt(ctx, chatId, ctx.from!);
  if (isExempt) {
    return next();
  }

  // 3. Retrieve the alphabet filter config for this group
  const filterConfig = ctx.groupSettings?.alphabetFilter;
  if (!filterConfig) {
    return next();
  }

  // 4. Determine which scripts are actually enabled (saves regex cycles)
  const enabledScripts = (
    Object.keys(filterConfig) as Array<keyof typeof filterConfig>
  ).filter((script) => filterConfig[script] === true);

  if (enabledScripts.length === 0) {
    return next();
  }

  // 5. Extract text to scan: message.text OR message.caption (not both needed —
  //    a message is either pure text or media-with-caption, never both)
  const textToScan = msg.text ?? msg.caption ?? "";
  if (!textToScan) {
    return next();
  }

  // 6. Test each enabled script — stop at the first match
  for (const script of enabledScripts) {
    const regex = SCRIPT_REGEXES[script];
    if (regex.test(textToScan)) {
      // Resolve the reason string through i18n so the group notice and log
      // card respect the group's configured locale (id / en).
      const reasonKey = `reason_alphabet_${script}` as const;
      const reason = ctx.t(reasonKey);

      logger.info(
        { event: "alphabet_filter_triggered", chatId, userId, script },
        "Alphabet filter matched — applying restriction punishment",
      );

      await applyRestrictionPunishment(ctx, chatId, userId, reason, "ALPHABETKICK");
      // Stop propagation — message has been handled (deleted + user kicked)
      return;
    }
  }

  // No match — pass through
  return next();
}
