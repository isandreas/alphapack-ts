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

// ── Moderation & Community (Phase 2+) ─────────────────────────────────────────

/**
 * Warn counts for users in a group.
 * Type: Redis hash (field = userId string, value = warn count string).
 * Operations: HINCRBY / HGET / HDEL / HSET.
 *
 * @example warnsKey(-1001234567890) → "alphapack:-1001234567890:warns"
 */
export function warnsKey(chatId: number): string {
  return `${NS}:${chatId}:warns`;
}

/**
 * Star counts for users in a group.
 * Type: Redis hash (field = userId string, value = star count string).
 * Operations: HINCRBY / HGET / HSET.
 *
 * @example starsKey(-1001234567890) → "alphapack:-1001234567890:stars"
 */
export function starsKey(chatId: number): string {
  return `${NS}:${chatId}:stars`;
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

/**
 * Redis set storing chatIds of groups approved by the bot owner.
 *
 * @example approvedGroupsKey() → "alphapack:bot:approved_groups"
 */
export function approvedGroupsKey(): string {
  return `${NS}:bot:approved_groups`;
}

/**
 * Redis set storing chatIds of groups currently awaiting owner approval.
 *
 * @example pendingApprovalGroupsKey() → "alphapack:bot:pending_approval_groups"
 */
export function pendingApprovalGroupsKey(): string {
  return `${NS}:bot:pending_approval_groups`;
}

/**
 * Redis set storing chatIds of groups banned by the bot owner.
 *
 * @example bannedGroupsKey() → "alphapack:bot:banned_groups"
 */
export function bannedGroupsKey(): string {
  return `${NS}:bot:banned_groups`;
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

/**
 * Per-user cooldown key for `@admin` relay triggers in a group.
 *
 * @example adminRelayCooldownKey(-1001234567890, 987654321) → "alphapack:-1001234567890:cooldown:admin_relay:987654321"
 */
export function adminRelayCooldownKey(chatId: number, senderId: number): string {
  return `${NS}:${chatId}:cooldown:admin_relay:${senderId}`;
}

/**
 * Per-target cooldown key for `@username` mention notifications in a group.
 *
 * @example mentionNotifyCooldownKey(-1001234567890, 987654321) → "alphapack:-1001234567890:cooldown:mention:987654321"
 */
export function mentionNotifyCooldownKey(chatId: number, targetId: number): string {
  return `${NS}:${chatId}:cooldown:mention:${targetId}`;
}

// ── Settings Editor State & Cooldowns (Phase 5 & Phase 7b) ────────────────────

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

/**
 * Per-user cooldown key for `/settings` command invocations (TTL = 4 s).
 *
 * @example settingsCooldownKey(987654321) → "alphapack:settings:cooldown:987654321"
 */
export function settingsCooldownKey(userId: number): string {
  return `${NS}:settings:cooldown:${userId}`;
}

/**
 * Per-user cooldown key for `/settings` menu "Edit" button taps (TTL = 3 s).
 *
 * @example settingsEditCooldownKey(987654321) → "alphapack:settings_edit:cooldown:987654321"
 */
export function settingsEditCooldownKey(userId: number): string {
  return `${NS}:settings_edit:cooldown:${userId}`;
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

// ── Phase 7: Ops & Health ──────────────────────────────────────────────────────

/**
 * Per-owner cooldown for the /health command (TTL = 60 s).
 *
 * @example healthCooldownKey(987654321) → "alphapack:health:cooldown:987654321"
 */
export function healthCooldownKey(userId: number): string {
  return `${NS}:health:cooldown:${userId}`;
}

/**
 * Unix timestamp (seconds as string) written by the scheduler after every
 * successful sweep. Read by /health to surface a silently-stalled scheduler.
 *
 * @example schedulerLastRunKey() → "alphapack:scheduler:last_run"
 */
export function schedulerLastRunKey(): string {
  return `${NS}:scheduler:last_run`;
}
