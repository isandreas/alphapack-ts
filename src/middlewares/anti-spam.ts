/**
 * middlewares/anti-spam.ts
 *
 * Anti-spam middleware — Phase 0 stub.
 *
 * Phase 0: This middleware is a pass-through. It is installed in the chain now
 * so the insertion point and ordering are established for Phase 2.
 *
 * Phase 2 will add:
 *   - Per-group flood rate limiting (INCR + EXPIREAT on floodKey)
 *   - Channel forward blocking (settings.features.blockChannelForwards)
 *   - Link/URL filtering for non-admins (settings.features.blockLinks)
 *   - Duplicate message detection (dupFingerKey)
 *
 * The global rate limiter (@grammyjs/ratelimiter, wired in bot.ts) provides
 * a baseline flood guard even in Phase 0.
 *
 * ⚠️  Scope note: do NOT implement moderation logic here in Phase 0.
 */

import type { NextFunction } from "grammy";
import type { BotContext } from "../types/context.js";

export async function antiSpamMiddleware(
  _ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  // Phase 0: pass-through — Phase 2 will add per-group checks here
  await next();
}
