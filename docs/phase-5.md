Context: Phase 0, Phase 1, Logging Infrastructure, Phase 2, Phase 3, and Phase 4 are
complete and verified. Build directly on top of them — reuse requireAdmin(),
getGroupSettings/setGroupSetting, isGroupAdmin, the group-listing-with-admin-
verification pattern from `!setlogchannel` (Logging Infrastructure pass), and every
underlying feature toggle/mechanism from Phases 2–4. Do not reimplement any of them —
this phase is primarily a UI layer (`@grammyjs/menu` + `@grammyjs/conversations`) on
top of settings that mostly already exist, plus a small number of genuinely new
settings (Custom Name, Rules, Moderation command-toggles, Lang). Long polling only,
no webhook.

Implement Phase 5: the `/settings` DM control panel.

## Part A — New settings this phase must add (nothing here existed before)
Extend `config/defaults.yaml` (and the per-group settings type):
```yaml
customBotName: null       # null = fall back to the bot's real Telegram first_name
rules:
  text: null               # null = "no rules set yet" i18n fallback
moderation:
  warn:   { enabled: false }   # default OFF — see migration note below
  tban:   { enabled: false }
  ban:    { enabled: false }   # also gates /unban
  mute:   { enabled: false }   # also gates /unmute
  warnThreshold: 5           # this value already existed conceptually; this phase
                              # adds the first UI/command to actually change it
locale: id                  # per-group override; falls back to DEFAULT_LOCALE if unset
```
> **Migration context:** this bot is being introduced gradually alongside an existing
> bot that already manages these groups, ahead of eventually sunsetting the old one.
> Every toggleable feature across the whole project — Moderation, floodGuard, welcome/
> goodbye/captcha, and mentions (adminRelay/userNotify) — defaults to OFF for exactly
> this reason: adding the new bot to a group must be a no-op until an admin
> deliberately turns individual features on, so the two bots never both act on the
> same `/warn`, `/ban`, etc. at once. If any defaults.yaml value from an earlier phase
> still says `enabled: true` in your current codebase, flip it to `false` as part of
> this pass — this is a deliberate, retroactive default-flip across the whole project,
> not scope creep.

### A1. Custom Name
- A plain string, editable via the menu (conversation-based text input, see Part F).
- Add a `{bot_name}` placeholder to the welcome/goodbye/rules template placeholder
  set (extending what Phase 3 established): resolves to `customBotName` if set, else
  the bot's actual Telegram `first_name`. Document this addition — it's a small
  retroactive extension to Phase 3's placeholder list, not a new templating system.

### A2. Rules
- Add a NEW public command `/rules` `!rules` (usable by anyone, not admin-only, group
  chats only) that replies with the group's stored rules text, or an i18n "no rules
  have been set yet" message if `rules.text` is null. This command didn't exist
  before this phase — it's a prerequisite for the Rules menu item to mean anything.
- The menu's Rules item lets an admin view/edit this text via the same
  conversation-based text-input pattern as A1.

### A3. Moderation submenu (warn / tban / ban+unban / mute+unmute toggles + threshold)
- Per your direction: disabling e.g. "ban" means `/ban` and `!ban` are refused
  entirely in that group until re-enabled — not just a partial behavior change.
  Implement a shared `isModerationFeatureEnabled(chatId, feature)` check
  (`feature: 'warn' | 'tban' | 'ban' | 'mute'`) and call it at the top of each
  relevant command handler:
  - `warn.ts` → checks `'warn'`
  - `tban.ts` → checks `'tban'`
  - `ban.ts` AND `unban.ts` (manual `/unban`) → both check `'ban'`
  - `mute.ts` AND `unmute.ts` → both check `'mute'`
  If disabled, reply with a clear i18n message ("this command is currently disabled
  in this group") rather than silently ignoring.
- **Enable All / Disable All shortcut** (per your request, specifically for the
  cutover moment): add two buttons at the top of the Moderation submenu — "✅ Enable
  All" and "🚫 Disable All" — that set all four of `moderation.warn/tban/ban/mute.
  enabled` in a single action, so the admin doesn't have to toggle four items
  individually right when they're ready to fully switch a group over from the old
  bot. Individual per-command toggles remain available below/alongside this shortcut
  for partial rollout (e.g. enabling just `warn` first to test before enabling `ban`).
- Judgment call — flag for review: the warn-threshold auto-ban escalation (Phase 1)
  is an automatic action, not a direct command invocation. Per this implementation,
  make it ALSO respect `moderation.ban.enabled`: if the threshold is hit but ban is
  disabled, the user is NOT auto-banned — just warned at the threshold count, with an
  extra note in the DM/log that auto-ban would have triggered but is disabled. This
  is the safer interpretation of "disabling ban means no bans happen," but it's your
  call to confirm or override.
- Explicitly do NOT gate the scheduler's automatic tban/mute expiry (auto-unban/
  auto-unmute when a timer runs out) behind these toggles — that's an internal
  cleanup process, not an admin-invoked command, and should always run regardless of
  whether the command itself is currently disabled. Similarly, flood-guard's
  auto-mute (Phase 2) is a SEPARATE subsystem gated only by its own `floodGuard.
  enabled` toggle — it calls the low-level mute mechanism directly, not through
  `/mute`, so `moderation.mute.enabled` does NOT affect it. Flag this distinction
  clearly in your implementation notes since it's a common point of confusion.
- The submenu also includes the warn-threshold number editor (conversation-based
  numeric input, validate it's a positive integer).

### A4. Lang
- First-ever UI/command to change a group's locale. Two buttons: "🇮🇩 Bahasa
  Indonesia" / "🇬🇧 English", each calling `setGroupSetting(chatId, 'locale', 'id'|
  'en')`. After selection, immediately re-render the current menu in the new locale
  so the admin sees the change take effect.

## Part B — Entry points

### B1. `/settings` in a GROUP
1. `requireAdmin()` — non-admins get a polite i18n denial, per your spec.
2. Check whether the admin has started a DM with the bot (reuse the
   `bot:started_users` Redis set from Phase 4). If not, reply in the group with a
   deep-link button to start a DM with the bot, and stop.
3. If they have: DM them the settings menu for THIS group directly (skip group
   selection — the group is already known from context) and reply briefly in the
   group confirming ("⚙️ Check your DMs").

### B2. `/settings` in a DM
1. If the user hasn't started... they're already in a DM, so that's moot — proceed.
2. Reuse the exact group-listing pattern from `!setlogchannel` (Logging
   Infrastructure): every group from the registry where this user is a
   freshly-verified admin (`isGroupAdmin`, not a stale cache).
3. NEW for this phase — per your instruction, also verify the BOT is an admin in
   each candidate group before offering it as a selectable option. Reuse the cached
   admin list from Phase 0's admin-guard (check whether the bot's own id appears in
   it) rather than an extra API call where possible. Groups where the bot isn't an
   admin should be excluded from the list entirely (with a short note in the UI if
   the resulting list is empty, e.g. "I'm not an admin in any group where you're an
   admin too").
4. Present the filtered list as an inline keyboard; on selection, render that group's
   settings menu.

## Part C — Top-level menu layout
- Send via `sendPhoto` with a static header image (use a placeholder asset path for
  now, e.g. `assets/settings-header.png` — swap in the real design asset later) and
  the inline keyboard as the photo's reply markup, matching the two-column layout
  style of the reference screenshot.
- Menu items, in this order, each routing per Part D/E below:
  Custom Name, Rules, Moderation, Anti-Spam, Anti-Flood, Welcome, Goodbye, Alphabets,
  Captcha, Check, @Admin, Tag, Media, Porn, Lang, Resolution Group, Tutup

## Part D — Working items (wire into EXISTING settings from earlier phases)
Build these as real submenus with toggle buttons / conversation-based text or number
input, following the same "Back to menu" navigation pattern throughout:
- **Anti-Flood** → `floodGuard.enabled` toggle, `messageThreshold` and
  `windowSeconds` numeric editors, punishment duration editor (punishment `type` stays
  fixed to `mute` for now since that's the only implemented case — don't expose a
  type selector yet)
- **Welcome** → `welcome.enabled` toggle, template text editor (reuse Phase 3's
  `setwelcome` logic under the hood, just triggered from the menu instead of the
  standalone command)
- **Goodbye** → `goodbye.enabled` toggle, template text editor
- **Captcha** → `welcome.captcha.enabled` toggle, `timeoutSeconds` numeric editor
- **@Admin** → `mentions.adminRelay.enabled` toggle, `cooldownSeconds` numeric editor
- **Tag** → per your confirmation, this is the SAME setting as Phase 4's
  `mentions.userNotify.enabled` — just expose the existing toggle and its
  `cooldownSeconds` here under the "Tag" label. Do not build a second feature.
- **Resolution Group** → reuse Phase 1's custom ban-message-template + appeal-group-link flow under the hood, triggered from this menu item.
- **Moderation** → per Part A3 above
- **Rules** → per Part A2 above
- **Custom Name** → per Part A1 above
- **Lang** → per Part A4 above

## Part E — "Under Development" placeholders
Per your instruction: any menu item without a real underlying feature yet shows a
placeholder rather than a broken submenu. For these items — **Anti-Spam**, **Alphabets**,
**Check**, **Media**, **Porn** — tapping the button should answer the callback query
with a short toast (e.g. "🚧 Under Development") and NOT navigate to a submenu at all
(no dead-end screen, just the toast, staying on the current menu). Note: "Anti-Spam"
specifically refers to the duplicate-message/link-filter detection that was
explicitly scoped out of Phase 2 — the lightweight rate limiter that DOES exist is
infra-only and intentionally has no per-group settings, so there's nothing real to
expose here yet.

## Part F — Text/number input pattern (shared across several items)
For any setting needing free text or a number (Custom Name, Rules text, Welcome/
Goodbye templates, warn threshold, flood thresholds, cooldowns, captcha timeout):
use a `@grammyjs/conversations` flow triggered by an "✏️ Edit" button inside the
relevant submenu: prompt for the new value, validate it (non-empty for text; positive
integer for numbers, with a clear re-prompt on invalid input rather than silently
failing), save via `setGroupSetting`, then re-render the submenu showing the updated
value. Build this as one reusable conversation/helper, not one copy-pasted per
setting.

## Part G — `Tutup` (Close)
- Edits the menu message to a simple closed/dismissed state (e.g. removes the
  keyboard and changes the caption to something like "Settings closed. Run /settings
  again to reopen.") rather than deleting the message outright.

## Part H — Non-admin denial
- Already covered for the group entry point (B1). For the DM entry point (B2), if
  the resulting admin-groups list is empty, that IS the polite denial — no separate
  error path needed beyond the empty-list message already specified in B2 step 3.

## Explicitly out of scope for this pass
- Any real implementation of Anti-Spam (duplicate/link detection), Alphabets, Check,
  Media, or Porn — placeholders only, per Part E
- A punishment-type selector for Anti-Flood (still mute-only)
- Multi-language menu labels beyond what the Lang toggle already re-renders (i.e.
  don't build a third language)

## Acceptance checklist
- [ ] `/settings` in a group as a non-admin is politely refused
- [ ] `/settings` in a group as an admin who hasn't started a DM prompts them to
      start one, with a working deep-link button
- [ ] `/settings` in a group as an admin who HAS started a DM immediately opens that
      group's menu in DM, with a group-side confirmation reply
- [ ] `/settings` in a DM lists only groups where the requesting user is a
      freshly-verified admin AND the bot itself is a verified admin — confirm with a
      real test group where the bot is present but NOT an admin, and verify that
      group is excluded from the list
- [ ] The top-level menu renders via `sendPhoto` with the header image and correct
      button layout/order
- [ ] Anti-Flood, Welcome, Goodbye, Captcha, @Admin, and Tag submenus all correctly
      read AND write the exact same underlying settings built in Phases 2–4 (toggle
      one via the new menu, confirm it takes effect the same way the old standalone
      command would have — e.g. toggle Welcome off via the menu, confirm `/welcome`
      command's own status check now reflects it)
- [ ] Resolution Group menu item triggers the custom ban template flow
- [ ] Freshly checked-out/deployed defaults have EVERY toggleable feature (Moderation
      warn/tban/ban/mute, floodGuard, welcome, goodbye, captcha, adminRelay,
      userNotify) set to `enabled: false` — confirm no earlier-phase `enabled: true`
      default slipped through
- [ ] Moderation submenu: disabling "ban" makes `/ban` AND `!ban` AND `/unban`
      genuinely refuse to run, with a clear message — re-enabling restores them
- [ ] "Enable All" / "Disable All" in the Moderation submenu correctly sets all four
      of warn/tban/ban/mute in one action, and individual toggles still work
      independently afterward for partial adjustment
- [ ] Warn-threshold auto-ban escalation correctly respects `moderation.ban.enabled`
      per the Part A3 judgment call (or your override, if you changed it)
- [ ] Scheduler-driven auto-unban/auto-unmute (Phase 1) and flood-guard's auto-mute
      (Phase 2) are UNAFFECTED by the Moderation toggles — confirm explicitly, this
      is an easy thing to accidentally break
- [ ] Warn threshold is editable via the menu and the new value is actually used on
      the next warn
- [ ] Custom Name is editable and `{bot_name}` correctly resolves to it (or falls
      back to the bot's real name) in welcome/goodbye/rules text
- [ ] `/rules` `!rules` works for any group member (not just admins), showing the
      configured text or the "no rules set" fallback
- [ ] Lang toggle correctly switches the group's locale and the menu itself
      re-renders in the new language immediately
- [ ] Anti-Spam, Alphabets, Check, Media, and Porn all show an "Under Development"
      toast on tap and do NOT navigate anywhere
- [ ] Tutup closes the menu cleanly (edits to a closed state, doesn't error)
- [ ] All text/number inputs validate and re-prompt on bad input rather than crashing
      or silently accepting garbage

Report back with: which files changed/added, confirmation that each "working" menu
item calls into the SAME underlying setter/mechanism as its Phase 2–4 standalone
command rather than a parallel implementation, how you structured the shared text/
number-input conversation helper, your final call on the warn-threshold-auto-ban vs
moderation.ban.enabled interaction, and the manual test steps you ran for both entry
points (group-initiated and DM-initiated) plus at least one full toggle-off/toggle-on
cycle for a Moderation command.