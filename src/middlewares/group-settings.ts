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

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import type { NextFunction } from "grammy";
import type { BotContext } from "../types/context.js";
import type { GroupSettings } from "../types/settings.js";
import { getRedisClient } from "../db/redis.js";
import { groupSettingsKey, knownGroupsKey } from "../db/keys.js";
import { logger } from "../utils/logger.js";
import { postActionCard } from "./logger.js";

// ── Resolve __dirname for NodeNext (CJS fallback handles both cases) ───────────

// __dirname is always available in CJS output ("type": "commonjs" in package.json).
// The fileURLToPath shim is not needed and causes a TS error under NodeNext CJS.
const ROOT_DIR: string = __dirname;

// ── Defaults (loaded once at startup) ─────────────────────────────────────────

let _defaults: GroupSettings | null = null;

function getDefaults(): GroupSettings {
  if (_defaults) return _defaults;

  const distYamlPath = join(ROOT_DIR, "../config/defaults.yaml");
  const srcYamlPath = join(ROOT_DIR, "../../src/config/defaults.yaml");
  const yamlPath = existsSync(distYamlPath) ? distYamlPath : srcYamlPath;
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

// ── Menu-Specific Writer + Audit Card (Phase 7b) ──────────────────────────────

/**
 * Free-text setting keys whose old/new content should NOT be dumped verbatim
 * into the log channel. Maps dot-notation key → human-readable label.
 */
const FREE_TEXT_SETTING_LABELS: Record<string, string> = {
  "rules.text": "Rules text",
  "guide.text": "Guide text",
  "welcome.template": "Welcome template",
  "goodbye.template": "Goodbye template",
  "banMessage.template": "Ban message template",
  "tbanMessage.template": "Temp ban message template",
  customName: "Custom Name",
  botName: "Custom Name",
};

function isFreeTextSetting(key: string): boolean {
  return (
    key in FREE_TEXT_SETTING_LABELS ||
    key.endsWith(".text") ||
    key.endsWith(".template")
  );
}

function getNestedValue(obj: unknown, dotKey: string): unknown {
  const parts = dotKey.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return undefined;
    }
    cur = cur[part];
  }
  return cur;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatSettingVal(v: unknown): string {
  if (v === undefined || v === null) return "unset";
  return String(v);
}

async function resolveGroupLabel(chatId: number): Promise<string> {
  try {
    const redis = getRedisClient();
    const title = await redis.hget(knownGroupsKey(), String(chatId));
    if (title) {
      return `${escapeHtml(title)} [<code>${chatId}</code>]`;
    }
  } catch {
    // fallback below
  }
  return `<code>${chatId}</code>`;
}

function formatAdminLabel(ctx: Pick<BotContext, "from">): string {
  const from = ctx.from;
  if (!from) return "Unknown Admin";
  const name =
    [from.first_name, from.last_name].filter(Boolean).join(" ") ||
    from.username ||
    "Admin";
  return `<a href="tg://user?id=${from.id}">${escapeHtml(name)}</a> (<code>${from.id}</code>)`;
}

/**
 * Updates a group setting from the `/settings` menu or its editor conversation
 * AND posts a `#SETTINGSCHANGE` audit log card via `postActionCard`.
 *
 * Scoped strictly to `/settings` menu interactions — standalone commands
 * (`/welcome`, `/captcha`, `/adminmention`, etc.) continue calling
 * `setGroupSetting` directly and do NOT emit `#SETTINGSCHANGE` cards.
 */
export async function setGroupSettingViaMenu(
  chatId: number,
  key: string,
  newValue: string | number | boolean | null,
  ctx: Pick<BotContext, "from">,
): Promise<void> {
  // 1. Read current merged settings BEFORE writing so we can report old -> new
  const beforeSettings = await getGroupSettings(chatId);
  const oldValue = getNestedValue(beforeSettings, key);

  // 2. Persist the setting in Redis
  await setGroupSetting(chatId, key, newValue);

  // 3. Build and post the #SETTINGSCHANGE log card (no "Go to message" button)
  const groupLabel = await resolveGroupLabel(chatId);
  const adminLabel = formatAdminLabel(ctx);
  const dateStr = new Date().toISOString().replace("T", " ").substring(0, 19);

  let cardLines: string[];
  if (isFreeTextSetting(key)) {
    const label = FREE_TEXT_SETTING_LABELS[key] ?? key;
    cardLines = [
      `<b>Action:</b> SETTINGSCHANGE`,
      `<b>Admin:</b> ${adminLabel}`,
      `<b>Chat:</b> ${groupLabel}`,
      `<b>Setting:</b> ${escapeHtml(label)} (<code>${escapeHtml(key)}</code>)`,
      `<b>Change:</b> updated`,
      `<b>Date:</b> ${dateStr}`,
      `#SETTINGSCHANGE`,
    ];
  } else {
    cardLines = [
      `<b>Action:</b> SETTINGSCHANGE`,
      `<b>Admin:</b> ${adminLabel}`,
      `<b>Chat:</b> ${groupLabel}`,
      `<b>Setting:</b> <code>${escapeHtml(key)}</code>`,
      `<b>From:</b> <code>${escapeHtml(formatSettingVal(oldValue))}</code>`,
      `<b>To:</b> <code>${escapeHtml(formatSettingVal(newValue))}</code>`,
      `<b>Date:</b> ${dateStr}`,
      `#SETTINGSCHANGE`,
    ];
  }

  await postActionCard(chatId, cardLines.join("\n"));
}

/**
 * Bulk-updates all four Moderation toggles (`warn`, `tban`, `ban`, `mute`) from
 * the Moderation submenu's "Enable All" / "Disable All" shortcut and posts
 * ONE combined `#SETTINGSCHANGE` log card instead of four separate cards.
 */
export async function setModerationAllViaMenu(
  chatId: number,
  enabled: boolean,
  ctx: Pick<BotContext, "from">,
): Promise<void> {
  await setGroupSetting(chatId, "moderation.warn.enabled", enabled);
  await setGroupSetting(chatId, "moderation.mute.enabled", enabled);
  await setGroupSetting(chatId, "moderation.tban.enabled", enabled);
  await setGroupSetting(chatId, "moderation.ban.enabled", enabled);

  const groupLabel = await resolveGroupLabel(chatId);
  const adminLabel = formatAdminLabel(ctx);
  const dateStr = new Date().toISOString().replace("T", " ").substring(0, 19);

  const cardLines = [
    `<b>Action:</b> SETTINGSCHANGE`,
    `<b>Admin:</b> ${adminLabel}`,
    `<b>Chat:</b> ${groupLabel}`,
    `<b>Setting:</b> Moderation (warn, tban, ban, mute)`,
    `<b>To:</b> <code>${enabled ? "ENABLED" : "DISABLED"}</code>`,
    `<b>Date:</b> ${dateStr}`,
    `#SETTINGSCHANGE`,
  ];

  await postActionCard(chatId, cardLines.join("\n"));
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
