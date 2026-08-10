/**
 * middlewares/group-settings.ts
 *
 * Loads per-group settings and injects them onto ctx.groupSettings.
 *
 * Merge strategy (highest priority wins):
 *   Redis hash (HGETALL groupSettingsKey(chatId))
 *   ← layered on top of →
 *   defaults.yaml (loaded once at startup)
 *
 * The public accessor getGroupSettings(chatId) is the single source of truth
 * for group config. Every phase reads settings through this function — never
 * directly from Redis or the YAML file.
 *
 * Phase 0: read-only accessor + middleware that injects ctx.groupSettings.
 * Phase 5: /settings write path that calls HSET on groupSettingsKey.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import type { NextFunction } from "grammy";
import type { BotContext } from "../types/context.js";
import type { GroupSettings } from "../types/settings.js";
import { getRedisClient } from "../db/redis.js";
import { groupSettingsKey } from "../db/keys.js";
import { logger } from "../utils/logger.js";

// ── Resolve __dirname for NodeNext (CJS fallback handles both cases) ───────────

// __dirname is always available in CJS output ("type": "commonjs" in package.json).
// The fileURLToPath shim is not needed and causes a TS error under NodeNext CJS.
const ROOT_DIR: string = __dirname;

// ── Defaults (loaded once at startup) ─────────────────────────────────────────

let _defaults: GroupSettings | null = null;

function getDefaults(): GroupSettings {
  if (_defaults) return _defaults;

  const yamlPath = join(ROOT_DIR, "../config/defaults.yaml");
  try {
    const raw = readFileSync(yamlPath, "utf-8");
    _defaults = parseYaml(raw) as GroupSettings;
    return _defaults;
  } catch (err: unknown) {
    logger.error(
      { event: "defaults_load_error", path: yamlPath, err },
      "Failed to load defaults.yaml — this is a fatal startup error",
    );
    throw err;
  }
}

// ── Accessor ──────────────────────────────────────────────────────────────────

/**
 * Returns the merged settings for a group.
 * Redis overrides take priority over YAML defaults on a per-key basis.
 *
 * Falls back to pure defaults if Redis is unavailable — the bot continues
 * to function with sensible defaults rather than crashing.
 */
export async function getGroupSettings(chatId: number): Promise<GroupSettings> {
  const redis = getRedisClient();
  const key = groupSettingsKey(chatId);

  try {
    const overrides = await redis.hgetall(key);
    const defaults = getDefaults();

    if (!overrides || Object.keys(overrides).length === 0) {
      return defaults;
    }

    // Merge: Redis flat-key overrides win over YAML defaults.
    // Redis stores everything as strings — coerce to correct JS types.
    return deepMerge(
      defaults as unknown as Record<string, unknown>,
      parseRedisOverrides(overrides),
    ) as unknown as GroupSettings;
  } catch (err: unknown) {
    logger.warn(
      { event: "group_settings_fallback", chatId, err },
      "Redis unavailable — using YAML defaults for group settings",
    );
    return getDefaults();
  }
}

// ── Writer ────────────────────────────────────────────────────────────────────

/**
 * Sets a single key in a group's Redis settings hash.
 * Passing null deletes the key (reverts to YAML default).
 *
 * This is the write counterpart to getGroupSettings() — it writes to the
 * same Redis hash that the read path merges over defaults.yaml.
 */
export async function setGroupSetting(
  chatId: number,
  key: string,
  value: string | number | boolean | null,
): Promise<void> {
  const redis = getRedisClient();
  const redisKey = groupSettingsKey(chatId);
  if (value === null) {
    await redis.hdel(redisKey, key);
  } else {
    await redis.hset(redisKey, key, String(value));
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Injects ctx.groupSettings for every group/supergroup update.
 * No-op for private chats (DMs don't have per-group settings).
 *
 * Install after session and i18n middleware, before command handlers.
 */
export async function groupSettingsMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const chat = ctx.chat;

  if (chat) {
    if (chat.type === "group" || chat.type === "supergroup") {
      ctx.groupSettings = await getGroupSettings(chat.id);
    } else if (chat.type === "private" && ctx.session?.settingsChatId) {
      ctx.groupSettings = await getGroupSettings(ctx.session.settingsChatId);
    }
  }

  await next();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parses a flat Redis HGETALL result into a nested object using dot-notation
 * keys. E.g. { "moderation.warnThreshold": "5" } → { moderation: { warnThreshold: 5 } }
 */
function parseRedisOverrides(
  hash: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [flatKey, rawValue] of Object.entries(hash)) {
    const parts = flatKey.split(".");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cursor: any = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (typeof cursor[part] !== "object" || cursor[part] === null) {
        cursor[part] = {};
      }
      cursor = cursor[part];
    }

    cursor[parts[parts.length - 1]!] = coerce(rawValue);
  }

  return result;
}

/** Coerces a Redis string value to the appropriate JS primitive. */
function coerce(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  const num = Number(value);
  if (!Number.isNaN(num) && value.trim() !== "") return num;
  return value;
}

/** Deep-merges source into target — source keys win. */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof target[k] === "object" &&
      target[k] !== null
    ) {
      out[k] = deepMerge(
        target[k] as Record<string, unknown>,
        v as Record<string, unknown>,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}
