Context: Phase 0, Phase 1, Logging Infrastructure, Phase 2, and Phase 3 are complete
and verified. Build directly on top of them — reuse requireAdmin(),
getGroupSettings/setGroupSetting, the deep-link builder from utils/deep-link.ts (built
during the Logging Infrastructure pass for the "Go to message" button), and the
existing DM-send-with-try/catch pattern from Phase 1. Do not reimplement any of these.
Long polling only, no webhook. No /settings UI yet — that's Phase 5. No log-channel
cards for this phase — these are relay/notification features, not moderation actions,
so they do NOT call postLogCard.

Implement Phase 4 of the roadmap: `@admin` message relay to all admins' DMs (with a
trackable "report" state so admins can mark it resolved and stop duplicate work), and
`@username` mention notifications with a deep-link button.

## Part A — Settings shape
Extend `config/defaults.yaml` (and the per-group settings type) with:
```yaml
mentions:
  adminRelay:
    enabled: true
    cooldownSeconds: 60
  userNotify:
    enabled: true
    cooldownSeconds: 30
```
Admin commands (in-group, admin-only via requireAdmin(), support both `/cmd` and
`!cmd`, persist via setGroupSetting):
- `/adminmention on|off` — toggles the @admin relay feature
- `/mentionnotify on|off` — toggles the @username notify feature

## Part B — Shared prerequisite: skip bot senders
For BOTH features in this phase: if the message triggering the check was sent by a
bot (`ctx.from.is_bot === true`), skip processing entirely — don't relay, don't
notify. This prevents noise from other bots in the group (e.g. a game bot's message
text happening to contain "@admin" or a username). This is a different exemption from
`isAutoModerationExempt` (Phase 2) — that one is about NOT punishing bots; this one is
about not treating a bot's message as a trigger for these relay/notify features. Keep
them as separate checks even though both key off `is_bot`.

## Part C — `@admin` relay, with a "report" state so admins don't duplicate work
Each `@admin` trigger creates a lightweight "report" record so that once one admin
handles it, the others are informed and don't all respond to the same thing.

1. Detection: case-insensitive match of the literal trigger word `admin` preceded by
   `@`, as a whole word (regex word-boundary — must not match inside a longer
   username like `@administrator99`). Hardcode the trigger as `@admin` for this phase
   (don't build a configurable trigger word yet — that's a natural Phase 5 addition,
   flag it as such rather than building it now).
2. Respect `mentions.adminRelay.enabled` — skip entirely if false.
3. Cooldown: per (chatId, senderId), enforce `cooldownSeconds` between uses (Redis key
   with TTL is enough — no need for anything fancier). If on cooldown, either
   silently ignore or reply with a brief i18n cooldown notice — your choice, but be
   consistent and document which you picked. This exists specifically to prevent
   `@admin` being used to spam every admin's DM.
4. Create a report record in Redis keyed by `report:{chatId}:{triggerMessageId}`
   (the triggering message id is already unique per chat, so no separate UUID is
   needed). Fields: `chatId`, `chatTitle`, `messageId` (the triggering message),
   `senderId`, `senderName`, `createdAt`, `resolved: false`. Set a TTL on this key
   (e.g. 7 days) so old reports don't accumulate forever.
5. Resolve the group's admin list — reuse the cached admin list mechanism from
   Phase 0's admin-guard rather than calling `getChatAdministrators` fresh every time
   (a short TTL cache is fine here, this isn't a security-sensitive check like
   `!setlogchannel`'s verification was).
6. For each admin (skip bot admins, skip the message sender if they themselves are an
   admin — they already know what they just sent):
   a. Forward the triggering message to that admin's DM via `forwardMessage` (not
      copyMessage — forwarding preserves the "Forwarded from {sender}" attribution,
      which is useful context for the admin).
   b. Follow it with a short info message: which group it came from, and TWO inline
      buttons on one row: "🔗 Go to message" (using the shared deep-link builder) and
      "✅ Resolve" (callback data encoding the report id, e.g.
      `resolve:{chatId}:{triggerMessageId}` — well within Telegram's 64-byte callback
      data limit).
   c. Wrap each send in try/catch — if a given admin has blocked the bot or never
      started a DM with it, skip that admin and continue to the next one. Do not let
      one failure stop the relay to the remaining admins.
   d. For every admin the info message was successfully sent to, record their
      `{adminUserId: infoMessageId}` into the report record (e.g. a Redis hash
      `report:{chatId}:{triggerMessageId}:admin_messages`) — this is what lets you
      go back and edit every admin's copy when the report is resolved.
7. After attempting all admins, send one brief confirmation reply in the group (e.g.
   "🔔 Admins have been notified.") — do not reveal which specific admins did or
   didn't receive it.

## Part C2 — Resolving a report
Handle the `resolve:{chatId}:{messageId}` callback query (any admin's DM):

1. Look up the report record. If it doesn't exist (expired via TTL, or malformed
   callback data), answer the callback with a toast like "This report is no longer
   available" and stop.
2. Verify the resolving user is STILL an admin of that group (reuse `isGroupAdmin` —
   admin status can change between when the report was sent and when it's acted on).
   If they're no longer an admin, answer with a toast explaining that and stop —
   don't let a demoted admin resolve reports.
3. Atomically claim the resolution to avoid a race where two admins tap "Resolve"
   within the same moment: use a Redis `SET key value NX` (or equivalent
   compare-and-set) on something like `report:{chatId}:{messageId}:resolved_by` — only
   the admin whose `SET ... NX` succeeds is the one who "wins" and triggers the
   update flow below. Store their user id, display name, and a timestamp as the
   value.
   - If the claim FAILS (someone else already resolved it, even a split second
     earlier): answer this admin's callback with a toast like "Already resolved by
     {resolvedByName}" and stop — do not re-process the update flow, since the
     winning admin's flow already handles updating everyone's message.
   - If the claim SUCCEEDS: continue to step 4.
4. Mark the report record `resolved: true` with `resolvedBy` (id + display name) and
   `resolvedAt`.
5. For every `{adminUserId: infoMessageId}` recorded in Part C6d (including the
   resolving admin's own message), edit that message:
   - Append a status line to the existing text: something like "✅ Resolved by
     {resolvedByName} at {formatted datetime}" (i18n-wrapped, use the group's locale
     from getGroupSettings for date formatting — keep the format simple, no need for
     a date-formatting library).
   - Edit the inline keyboard to drop the "Resolve" button, keeping only "Go to
     message" — a resolved report shouldn't be resolvable again.
   - Wrap each edit in try/catch (the admin may have deleted the message, blocked the
     bot since, etc.) and continue to the next admin's message on failure — one
     failed edit must not stop the others from being updated.
6. Answer the resolving admin's own callback with a brief success toast (e.g. "Marked
   as resolved").

## Part D — `@username` mention notify
1. Detection: inspect `message.entities` for `type === 'mention'` (a `@username`
   text mention — Telegram does NOT give you the user_id for this type directly) and
   `type === 'text_mention'` (a mention of a user without a username, which DOES
   include the full `user` object with `id` directly in the entity — no lookup
   needed for this type).
2. For `type === 'mention'`: resolve the username to a user_id via a NEW Redis-backed
   registry — `features/mentions/user-registry.ts` — mapping username → user_id.
   Populate this registry opportunistically: every time the bot sees a message from
   any user (in any group, or in DM), upsert `username → user_id` if the user has a
   username set. This is a new piece of infrastructure this phase needs; note in your
   report that a username mentioned before ever being seen by the bot simply won't
   resolve — that's an inherent Bot API limitation, not a bug.
3. Also track which users have started a DM with the bot — a Redis set
   `bot:started_users`, populated on `/start` in DM (this may already partially exist
   from earlier phases' DM-related work; check before adding a duplicate mechanism).
   A user must be in this set for the bot to be able to DM them at all.
4. For each resolved mention in the message:
   - Skip if the resolved target is the message sender themselves (self-mention)
   - Skip if the resolved target is a bot
   - Skip if `mentions.userNotify.enabled` is false for this group
   - Skip (silently) if the target hasn't started the bot (can't be reached)
   - Enforce a per (chatId, targetUserId) cooldown using `cooldownSeconds`, so
     repeatedly mentioning the same person in a short burst doesn't spam their DM
     with duplicate notifications
   - Otherwise, DM the target: "You were mentioned in {group_name} by {sender_name}"
     (i18n), with a "Go to message" inline button via the shared deep-link builder.
     Wrap in try/catch per the standard DM pattern — a failure here should not affect
     processing of other mentions in the same message.
5. A single message can mention multiple users — process each entity independently.

## Explicitly out of scope for this pass
- Configurable `@admin` trigger word — hardcoded for now, flag as a Phase 5 candidate
- Any /settings UI — the two admin commands in Part A are the only way to configure
  this until Phase 5
- User-level opt-out of being notified when mentioned — not requested, don't build it
  speculatively; flag it as a possible future addition if you think it's worth noting
- Notifying the GROUP itself when a report is resolved (e.g. no reaction/reply posted
  back to the original group message) — resolution status only appears in the admins'
  DMs per the spec. Flag as a possible future addition, don't build it now.
- postLogCard integration — these are not moderation actions

## Acceptance checklist
- [ ] `@admin` (case-insensitive, whole word) in a group message with the feature
      enabled forwards the message to every admin's DM, each followed by an info
      message with both "Go to message" and "Resolve" buttons
- [ ] A message containing `@administrator` or similar does NOT false-trigger the
      admin relay
- [ ] An admin who has blocked the bot or never started a DM does not break the relay
      to other admins — confirm with a real test where at least one admin can't be
      reached
- [ ] The message sender, if themselves an admin, does not receive a redundant DM of
      their own message
- [ ] Repeated `@admin` use within `cooldownSeconds` is correctly throttled
- [ ] Tapping "Resolve" on one admin's copy updates ALL other admins' copies of that
      same report — text shows who resolved it and when, and the "Resolve" button is
      removed from every copy (only "Go to message" remains)
- [ ] Two admins tapping "Resolve" on the same report at nearly the same time: only
      one is recorded as the resolver (via the atomic claim), and the other gets an
      "already resolved by X" toast rather than overwriting the first resolution
- [ ] An admin whose admin status was revoked between receiving the report and
      tapping "Resolve" is correctly blocked from resolving it
- [ ] A report that has expired (past its TTL) or has malformed callback data fails
      gracefully with a toast, not a crash
- [ ] `@username` mention of a user who has previously interacted with the bot (so
      they're in the registry) and has started a DM correctly triggers a notification
      with a working deep-link button
- [ ] `@username` mention of someone NOT in the registry (never seen by the bot)
      fails silently with no error — confirm this is treated as expected behavior,
      not a bug to fix
- [ ] A `text_mention` (mentioning a user without a username) resolves directly via
      the entity's embedded user object, without needing the registry
- [ ] Self-mentions and mentions of bots are correctly skipped
- [ ] Multiple mentions in a single message are all processed independently
- [ ] Repeated mentions of the same user within `cooldownSeconds` are throttled to a
      single notification
- [ ] Messages sent by a bot account never trigger either feature (Part B)
- [ ] `/adminmention on|off` and `/mentionnotify on|off` work via both `/cmd` and
      `!cmd`, admin-only, and correctly gate their respective features
- [ ] No postLogCard calls introduced for either feature
- [ ] No /settings UI, configurable trigger word, or group-facing resolution
      notification introduced

Report back with: which files changed/added, the exact Redis structure used for the
report record + per-admin message tracking + username registry + started-users set,
how you implemented the atomic "claim resolution" step (and confirm it's genuinely
race-safe, not just "usually works"), whether you found and reused an existing
started-users mechanism from an earlier phase or had to add it fresh, and the manual
test steps you ran for both features — including at least one admin/user who couldn't
be reached, and a deliberate attempt to resolve the same report from two admin
accounts to confirm the race handling.