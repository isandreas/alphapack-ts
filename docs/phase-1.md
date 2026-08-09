Context: Phase 0 is complete and verified — command-parser (/cmd + !cmd), admin-guard
(isGroupAdmin / requireAdmin()), getGroupSettings(chatId), Redis client, and i18n
(en/id) all exist and work. Build directly on top of these; do not reimplement them.

Implement Phase 1 of the roadmap: core moderation commands — warn, mute, tban, ban.
Still no anti-spam, no welcome messages, no /settings menu — those remain later phases.
Long polling only, no webhook.

## Shared behavior required across ALL four commands

Every moderation command (warn, mute, tban, ban) must, in this order:
1. Only run in group chats (reply with an i18n error if used in DM)
2. Require the sender to pass `requireAdmin()` (from Phase 0)
3. Resolve the target user — support both replying to a message ("reply with /ban")
   and an explicit @username or numeric user_id argument. If neither is present or
   the target can't be resolved, reply with a clear i18n error explaining usage.
4. Refuse to act on: the bot itself, another admin/owner of the chat, and the command
   sender acting on themselves. Reply with an i18n "target is immune" message.
5. Perform the Telegram API action (see per-command detail below)
6. Persist the action to Redis (see db/keys.ts — extend with new key helpers as
   needed, following the Phase 0 naming convention)
7. Attempt to DM the target user a notification (see "DM notification" section below)
   — never let a failed DM (blocked bot, user never started it) crash or block the
   command; catch and continue.
28. Post a formatted "action card" to the group's log channel if one is configured
   (log channel id lives in group settings; if not configured, skip this step
   silently — do not error). Format: action type, target user formatted as a link
   `<Display Name> [<user_id>]`, admin who issued it, reason/duration if applicable, timestamp.
9. Reply in the group confirming the action (localized via i18n), formatting the target as `<Display Name> [<user_id>]` which links to their profile.

*Note on target resolution*: The bot uses a `username-tracker` middleware that tracks `@username` to `user_id` mappings in Redis with a 7-day TTL, allowing admins to moderate users by `@username` even if they are not in the message's reply context.

## Per-command detail

### /warn, !warn
- Optional trailing text after the command = reason, e.g. `/warn spamming links`
- Increment a Redis counter: warnKey(chatId, userId) → increment, no expiry by default
  (persistent until manually cleared or user is banned)
- Read warnThreshold from getGroupSettings(chatId) (default 5, per Phase 0 defaults.yaml)
- If the incremented count >= threshold:
  - Escalate to a full ban (see /ban logic below) instead of just warning
  - The DM sent to the user in this case is the "you have been banned for reaching
    the warn limit" variant, not the plain warn notice
- If below threshold: just DM the plain warn notice (see below) and post the log card
- Support an optional custom message directly within the `/warn` command (e.g. `/warn @user spamming is bad` without quotes).
- The reply to `/warn` includes an inline button `➖ Remove Warning (-1)` restricted to admins to easily undo warnings.
- *Note:* Custom ban message templates (`customBanTemplate` in group settings) are supported and will be used automatically when a user hits the threshold and is auto-banned.

### /mute, !mute
- Duration argument REQUIRED (reply with usage error if missing) via the time-parser
  utility — support formats like `10m`, `2h`, `1d`.
- Use `restrictChatMember` with all permissions revoked (can't send messages/media)
- If a duration is given: store an expiry in Redis and schedule an auto-unmute (see
  "Scheduler" section below)
- `/unmute` `!unmute` counterpart command to manually lift a mute early

### /tban, !tban
- Duration argument REQUIRED (reply with usage error if missing) — same time-parser
- Use `banChatMember` with an `until_date` set via the Telegram API's native temp-ban
  support, AND separately track it in Redis so your own scheduler can also
  proactively unban and DM the user "your temporary ban has ended" (Telegram's native
  until_date alone won't trigger a notification)

### /ban, !ban
- Optional reason argument
- Permanent `banChatMember` (no until_date)
- Uses the same custom-message-template mechanism as the warn-threshold auto-ban, if
  one is configured for the group — otherwise a default i18n ban notice

## DM notification format
When DMing an affected user, include:
- What happened (warned / muted / temp-banned / banned) and why (reason, if given)
- For warns: current count vs threshold (e.g. "3/5")
- For temp-bans: duration and expiry time
- If a custom message + button template is configured for the group, use it.
- If no custom template: a sensible default i18n message.
- For `unban` actions (manual or scheduled temporary ban expiry), automatically generate a "Rejoin Group" inline button using `exportChatInviteLink(chatId)`.
- Wrap the DM send in try/catch; on failure (user hasn't started the bot / blocked
  it), do not surface this as an error to the admin beyond a soft note like "(user
  could not be notified via DM)" appended to the group confirmation reply

## Scheduler (tban and timed mutes)
- Implement `features/scheduler/unban-scheduler.ts` (and reuse it for unmute)
- Given this is a 768MB VPS, prefer a lightweight approach over adding BullMQ/a queue
  system: a Redis `zset` (sorted set) with the score as the Unix timestamp. A periodic loop
  polls every 30s to execute due unbans/unmutes. This approach is highly memory-efficient.
  this scale. Only reach for BullMQ if you have a specific reason the simple sweep
  won't work — flag that reasoning if you deviate.
- On expiry: call `unbanChatMember` / restore permissions via `restrictChatMember`,
  DM the user, and post a log card noting the automatic expiry action

## Acceptance checklist
- [ ] All four commands work via both `/cmd` and `!cmd` in a real test group
- [ ] Non-admins attempting any of these commands are correctly refused
- [ ] Attempting to warn/mute/ban another admin, the bot itself, or self is refused
      with a clear message
- [ ] Warn count persists across bot restarts (stored in Redis, not memory)
- [ ] Reaching the warn threshold correctly escalates to an auto-ban, using the
      custom message template if one is configured, and correctly falls back to the
      default message if not
- [ ] /mute and /tban correctly parse duration strings (10m, 2h, 1d) and reject
      malformed ones with a clear usage error
- [ ] A scheduled tban/mute actually expires and auto-lifts without any manual
      intervention, and the user receives a DM when it does
- [ ] Log channel receives a correctly formatted action card for every action, when
      a log channel is configured — and nothing errors when one isn't configured
- [ ] A blocked/never-started DM never crashes the command or leaves the group
      confirmation unsent
- [ ] No anti-spam, welcome message, or /settings menu logic introduced in this pass

Report back with: which files changed/added, the exact Redis key patterns you used for
warn counts and scheduled expiries, any deviation from "simple sweep" scheduling and
why, and the manual test steps you ran for each of the four commands.