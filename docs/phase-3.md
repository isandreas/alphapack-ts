Context: Phase 0, Phase 1, Logging Infrastructure, and Phase 2 are complete and
verified. Build directly on top of them — reuse getGroupSettings/setGroupSetting,
postLogCard, the mute mechanism (restrictChatMember), the shared
`isAutoModerationExempt(member)` helper from Phase 2 (covers admins and bots), and —
importantly — the existing scheduled-action sweep from Phase 1/2 (the Redis sorted-set
+ periodic sweep originally built for tban/mute expiry). Do not build a second
scheduler; generalize the existing one if it isn't already generic enough to carry a
new action type. Long polling only, no webhook. No /settings UI yet — that's Phase 5.

Implement Phase 3 of the roadmap: welcome message on join, goodbye message on leave,
and an optional captcha gate for new members.

## Part A — Settings shape
Extend `config/defaults.yaml` (and the per-group settings type) with:
```yaml
welcome:
  enabled: true
  template: "Welcome {mention} to {group_name}! 👋"
  captcha:
    enabled: false
    timeoutSeconds: 60
goodbye:
  enabled: false
  template: "{first_name} has left {group_name}."
```
Supported placeholders (document these clearly, apply consistently in both templates):
`{username}` (@handle, falls back to display name if no username), `{first_name}`,
`{mention}` (clickable HTML/MarkdownV2 mention using the user's id — this is the one
that should be used for tagging someone who may not have a username), `{group_name}`.

## Part B — Admin commands to configure these (stopgap until Phase 5's UI)
In-group, admin-only (reuse `requireAdmin()`), support both `/cmd` and `!cmd`:
- `/welcome on|off` — toggles welcome messages
- `/setwelcome <text>` — sets the group's welcome template (validate placeholders are
  well-formed; don't silently accept garbage)
- `/goodbye on|off` — toggles goodbye messages
- `/setgoodbye <text>` — sets the group's goodbye template
- `/captcha on|off` — toggles the captcha gate independently of welcome (captcha can
  be on even if the welcome text itself is disabled — handle that combination:
  if welcome is off but captcha is on, still show the captcha challenge, just without
  the friendly welcome copy, since the captcha message doubles as the challenge UI)
All four persist via `setGroupSetting`, same pattern as `logChannelId` from the
Logging Infrastructure pass.

## Part C — On member join
Handle `new_chat_members` (there can be multiple users in a single update — process
each independently, don't assume exactly one):

For each joining user:
0. Check `isAutoModerationExempt(member)` (the shared helper added in Phase 2, Part A
   — covers `is_bot === true` as well as admins being re-added). If true: skip the
   captcha gate entirely regardless of the `welcome.captcha.enabled` setting — bots
   (e.g. game bots, other utility bots being added to the group) must never be
   restricted or challenged. Default to also skipping the welcome message for bots
   (a "Welcome, DiceBot!" message is just clutter), but still respect
   `welcome.enabled` if you'd rather send it anyway — flag which you chose. Then
   continue to the next joining user; do not fall through into steps 1–3 below for
   an exempt member.
1. If `welcome.captcha.enabled` is true:
   a. Immediately restrict the user (reuse the exact same `restrictChatMember`
      mechanism as `/mute`) so they can't send messages until they pass the captcha.
   b. Send a message combining the welcome template (if `welcome.enabled`) with a
      simple challenge: an inline button (e.g. "✅ I'm not a robot" or a trivial
      one-tap confirmation — no need for anything more elaborate than a button-tap
      given the scope) tied to that specific user's id in the callback data.
   c. Schedule a timeout action via the EXISTING generic scheduled-action sweep
      (extend its action-type field if needed — e.g. `{type: 'captcha-kick', chatId,
      userId, dueAt}` alongside the existing `unmute`/`unban` entries) for
      `timeoutSeconds` from now.
2. If captcha is disabled but `welcome.enabled` is true: just send the welcome
   message immediately, no restriction.
3. If both are disabled: do nothing.

## Part D — Captcha button handler
- On callback query from the challenge button: verify the clicking user's id matches
  the target user id encoded in the callback data. If it's a different user clicking
  (someone else tapping the button on the new member's behalf, or trying to grief),
  answer the callback with a silent/ephemeral "this isn't for you" toast — do not
  unrestrict anyone, do not modify the message.
- If it's the correct user: unrestrict them (lift the mute), edit the challenge
  message to a simple success state (or delete it and send a fresh confirmation —
  your choice, keep it clean), and remove their pending entry from the
  scheduled-action sweep so the timeout doesn't fire late and kick someone who
  already passed.

## Part E — Captcha timeout (via the existing sweep)
- When the generic sweep finds a due `captcha-kick` entry: kick the user
  (`banChatMember` immediately followed by `unbanChatMember` so they're removed but
  not permanently banned and can rejoin/be re-added later), delete the now-stale
  challenge message if still present, and post a log card.
- Log card: use `postLogCard` with a new `#CAPTCHAKICK` tag, following the same
  structural convention as `#FLOODMUTE` (Admin: "System (Auto-Moderation)", Chat,
  User, Reason: "captcha not completed within {timeoutSeconds}s", no Count line, no
  "go to message" button since there's no source message to link to). This format is
  not locked in — flag it for review same as `#FLOODMUTE` was.

## Part F — On member leave
- Handle `left_chat_member`. If `goodbye.enabled` is true, send the goodbye template
  to the group. This is a simple fire-and-forget group message — no logging, no DM,
  no scheduler involvement. Skip entirely if the "leave" was actually this user being
  kicked/banned by the bot itself in Part E or by an admin command (Phase 1) — you
  don't want a redundant goodbye message right after a ban/kick action card. Use
  whatever signal is simplest and reliable to distinguish an organic leave from a
  bot-initiated removal (e.g. a short-lived Redis flag set right before the bot calls
  banChatMember/kick, checked and cleared when handling left_chat_member).

## Explicitly out of scope for this pass
- Any /settings UI — the four admin commands in Part B are the only way to configure
  this until Phase 5
- Anything beyond a single-tap captcha button (no math challenges, no image captchas)
- Changes to logging, flood-guard, or the scheduler's existing action types beyond
  adding `captcha-kick` alongside them

## Acceptance checklist
- [ ] A bot account (e.g. a game bot) added to the group is NEVER restricted or shown
      the captcha challenge, regardless of the `welcome.captcha.enabled` setting,
      via the shared `isAutoModerationExempt` helper — not a separate ad hoc check
- [ ] A new member joining a group with welcome enabled and captcha disabled
      immediately receives the welcome message with placeholders correctly filled in
- [ ] A new member joining with captcha enabled is immediately restricted and shown
      the challenge button; they cannot send messages until they tap it
- [ ] Tapping the button as a DIFFERENT user does nothing except a silent toast — the
      real target user remains restricted
- [ ] Tapping the button as the correct target user lifts the restriction and updates
      the challenge message
- [ ] Not tapping the button within `timeoutSeconds` results in an automatic kick
      (ban immediately followed by unban) and a `#CAPTCHAKICK` log card, using the
      SAME scheduled-action sweep as Phase 1/2 — no second scheduler implementation
- [ ] A user who passes the captcha does NOT get kicked late by a stale timeout entry
      (confirm the pending entry is actually removed on success)
- [ ] `/welcome on|off`, `/setwelcome`, `/goodbye on|off`, `/setgoodbye`, and
      `/captcha on|off` all work via both `/cmd` and `!cmd`, admin-only
- [ ] Multiple users joining in a single `new_chat_members` update are all handled
      independently (test with 2+ simultaneous joins if possible)
- [ ] Goodbye message fires on an organic leave but does NOT double up with a ban/kick
      action's own log/notification
- [ ] No /settings UI, no math/image captcha, no changes to unrelated Phase 1/2 code
      paths beyond the scheduler's action-type extension

Report back with: which files changed/added, how you extended the scheduled-action
sweep to carry the new `captcha-kick` type (and confirm no second scheduler was
built), and the manual test steps you ran for welcome, goodbye, and both the
captcha-success and captcha-timeout paths.