/**
 * db/keys.ts
 *
 * Central Redis key naming helper.
 *
 * ALL Redis key strings must be defined here — never construct raw key strings
 * in feature modules. This ensures the naming convention is consistent across
 * all phases and renames stay in one place.
 *
 * Namespace convention:  alphapack:<chatId>:<feature>:<qualifier>
 *
 * All keys are per-chatId so a single Redis instance serves multiple groups
 * without collision.
 */

const NS = "alphapack";

// ── Group Settings ─────────────────────────────────────────────────────────────

/**
 * Redis hash key for per-group runtime settings.
 * Fields: any GroupSettings key (e.g. "locale", "warnThreshold").
 * Written via HSET, read via HGETALL.
 *
 * @example groupSettingsKey(-1001234567890) → "alphapack:-1001234567890:settings"
 */
export function groupSettingsKey(chatId: number): string {
  return `${NS}:${chatId}:settings`;
}

// ── Session ────────────────────────────────────────────────────────────────────

/**
 * Redis key for per-(chat, user) session data (grammY session plugin).
 *
 * @example sessionKey(-1001234567890, 987654321) → "alphapack:session:-1001234567890:987654321"
 */
export function sessionKey(chatId: number, userId: number): string {
  return `${NS}:session:${chatId}:${userId}`;
}

// ── Admin Cache ────────────────────────────────────────────────────────────────

/**
 * Redis key for the cached admin ID list of a group.
 * Value: JSON-encoded number[] of admin user IDs.
 * TTL: set by admin-guard middleware (default 5 min).
 *
 * @example adminCacheKey(-1001234567890) → "alphapack:-1001234567890:admin_cache"
 */
export function adminCacheKey(chatId: number): string {
  return `${NS}:${chatId}:admin_cache`;
}

// ── Moderation (Phase 2) ───────────────────────────────────────────────────────

/**
 * Warn count for a user in a group.
 * Type: Redis string (INCR / GET / DEL).
 *
 * @example warnKey(-1001234567890, 987654321) → "alphapack:-1001234567890:warn:987654321"
 */
export function warnKey(chatId: number, userId: number): string {
  return `${NS}:${chatId}:warn:${userId}`;
}

/**
 * Mute state for a user (optional TTL = mute duration).
 * Type: Redis string with optional EXPIREAT.
 *
 * @example muteKey(-1001234567890, 987654321) → "alphapack:-1001234567890:mute:987654321"
 */
export function muteKey(chatId: number, userId: number): string {
  return `${NS}:${chatId}:mute:${userId}`;
}

/**
 * Temporary ban record (TTL = remaining ban duration).
 * Type: Redis string with EXPIREAT = unban timestamp.
 *
 * @example tbanKey(-1001234567890, 987654321) → "alphapack:-1001234567890:tban:987654321"
 */
export function tbanKey(chatId: number, userId: number): string {
  return `${NS}:${chatId}:tban:${userId}`;
}

// ── Anti-Spam (Phase 2) ────────────────────────────────────────────────────────

/**
 * Flood counter for a user — used with INCR + EXPIREAT for sliding window.
 *
 * @example floodKey(-1001234567890, 987654321) → "alphapack:-1001234567890:flood:987654321"
 */
export function floodKey(chatId: number, userId: number): string {
  return `${NS}:${chatId}:flood:${userId}`;
}

// ── Username → User ID map (Phase 2) ──────────────────────────────────────────

/**
 * Redis hash mapping @username (lowercase) → user_id string.
 * Used to resolve @mentions to a numeric ID without an API call.
 *
 * @example usernameMapKey(-1001234567890) → "alphapack:-1001234567890:username_map"
 */
export function usernameMapKey(chatId: number): string {
  return `${NS}:${chatId}:username_map`;
}

// ── Scheduler (Phase 1) ────────────────────────────────────────────────────────

/**
 * Global Redis Sorted Set for scheduled actions (unmute, unban).
 * Score = timestamp (seconds).
 * Value = JSON string of action payload.
 *
 * @example schedulerZsetKey() → "alphapack:scheduler:zset"
 */
export function schedulerZsetKey(): string {
  return `${NS}:scheduler:zset`;
}

// ── Group Registry ─────────────────────────────────────────────────────────────

/**
 * Redis hash mapping chatId → chatTitle for all groups the bot is in.
 * Updated on my_chat_member events and opportunistically on group messages.
 *
 * @example knownGroupsKey() → "alphapack:bot:known_groups"
 */
export function knownGroupsKey(): string {
  return `${NS}:bot:known_groups`;
}

// ── Goodbye Suppression (Phase 3) ─────────────────────────────────────────────

/**
 * Temporary Redis key set right before a bot-initiated ban/kick to suppress
 * sending a redundant goodbye message in group chat.
 */
export function kickBypassGoodbyeKey(chatId: number, userId: number): string {
  return `${NS}:${chatId}:bypass_goodbye:${userId}`;
}

// ── Mentions & Reports (Phase 4) ──────────────────────────────────────────────

/**
 * Redis hash key for a report created by `@admin`.
 */
export function reportKey(chatId: number, messageId: number): string {
  return `${NS}:report:${chatId}:${messageId}`;
}

/**
 * Redis hash mapping adminUserId → infoMessageId for a report.
 */
export function reportAdminMessagesKey(chatId: number, messageId: number): string {
  return `${NS}:report:${chatId}:${messageId}:admin_messages`;
}

/**
 * Redis string key used to atomically claim resolution of a report.
 */
export function reportResolvedByKey(chatId: number, messageId: number): string {
  return `${NS}:report:${chatId}:${messageId}:resolved_by`;
}

/**
 * Global Redis hash mapping username (lowercase) → userId.
 */
export function globalUsernameMapKey(): string {
  return `${NS}:global:username_map`;
}

/**
 * Redis set storing user IDs of users who have started a DM with the bot.
 */
export function startedUsersKey(): string {
  return `${NS}:bot:started_users`;
}

// ── Settings Editor State (Phase 5) ───────────────────────────────────────────

/**
 * Short-lived Redis key (TTL 5 min) that carries the pending settings edit
 * state from a menu button callback into the settingsEditor conversation.
 *
 * Using Redis instead of ctx.session avoids the grammY conversations v2
 * replay-context issue where ctx.session is undefined during replay.
 *
 * @example settingsEditKey(987654321) → "alphapack:settings_edit:987654321"
 */
export function settingsEditKey(userId: number): string {
  return `${NS}:settings_edit:${userId}`;
}

// ── Command Cooldowns ──────────────────────────────────────────────────────────

/**
 * Redis key for command rate-limiting/cooldowns (e.g. /rules and /guide).
 *
 * @example commandCooldownKey(-1001234567890, "rules") → "alphapack:-1001234567890:cooldown:rules"
 */
export function commandCooldownKey(chatId: number, command: "rules" | "guide"): string {
  return `${NS}:${chatId}:cooldown:${command}`;
}

