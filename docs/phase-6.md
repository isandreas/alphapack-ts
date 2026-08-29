Context: Phase 0 through Phase 5 are complete and verified. Build directly on top of
them — reuse isAutoModerationExempt (bots + admins are exempt from these filters,
same as flood-guard and captcha), postLogCard, the ban-then-unban kick pattern from
Phase 3, and setGroupSetting. This phase also RETROFITS the `/settings` menu: replace
the "Alphabets" and "Media" "Under Development" toast-only handlers (from Phase 5,
Part E) with real submenus. Long polling only, no webhook.

Implement Phase 6: an alphabet/script filter and a media-type filter, both purely
menu-configured (no standalone `/command` for these — consistent with how Phase 5
introduced Moderation, Custom Name, Rules, and Lang as menu-only controls, unlike the
earlier phases' features which had standalone commands too). Each filter is a set of
INDEPENDENT per-item toggles — there is no overall "enable this feature" master
switch. Every individual toggle defaults to `false` (not restricted / allowed),
consistent with the project-wide migration default-OFF policy from Phase 5.

## Part A — Settings shape
Extend `config/defaults.yaml` (and the per-group settings type):
```yaml
alphabetFilter:
  cyrillic: false
  arabic: false
  cjk: false        # bundles Chinese Han, Hiragana/Katakana, and Hangul as one toggle
  thai: false
  hebrew: false
  devanagari: false
mediaFilter:
  photo: false
  video: false
  sticker: false
  gif: false          # Telegram represents GIFs as "animation", not a separate type
  link: false
```
Each boolean means "restricted" (`true` = messages matching this trigger the
punishment) — NOT "allowed." `false` (the default for everything) means that
script/media type is permitted, no action taken.

## Part B — Alphabet filter detection
Implement `features/moderation/alphabet-filter.ts` as a grammY middleware running on
group text messages AND captions (photos/videos/etc. with a caption should also be
scanned — don't only check `message.text`, also check `message.caption`):

1. Skip entirely if `isAutoModerationExempt(ctx.from)` is true (admins and bots).
2. For each script where the group's setting is `true`, test the message text/caption
   against that script's Unicode range using a simple regex — no external
   script-detection library needed, plain regex ranges are sufficient and much
   lighter given the VPS's memory budget:
   - Cyrillic: `\u0400-\u04FF`
   - Arabic: `\u0600-\u06FF` (include `\u0750-\u077F` Arabic Supplement if easy, not
     required)
   - CJK: `\u4E00-\u9FFF` (Han) OR `\u3040-\u30FF` (Hiragana/Katakana) OR
     `\uAC00-\uD7A3` (Hangul) — any one of these matching counts as CJK
   - Thai: `\u0E00-\u0E7F`
   - Hebrew: `\u0590-\u05FF`
   - Devanagari: `\u0900-\u097F`
3. Per your decision: ANY single matching character from a restricted script is
   enough to trigger a violation — do not calculate a percentage/majority threshold.
4. Only check scripts whose toggle is `true` — don't waste cycles testing disabled
   scripts.
5. On a match: trigger the punishment (Part D).

## Part C — Media filter detection
Implement `features/moderation/media-filter.ts` as a grammY middleware running on
every group message:

1. Skip entirely if `isAutoModerationExempt(ctx.from)` is true.
2. Determine the message's type and check the corresponding setting:
   - `message.photo` present → check `mediaFilter.photo`
   - `message.video` present → check `mediaFilter.video`
   - `message.sticker` present → check `mediaFilter.sticker` (covers both static and
     animated/video stickers as one category — don't split them further)
   - `message.animation` present → check `mediaFilter.gif` (this is how Telegram
     represents GIFs; there is no separate "gif" message type)
   - A URL is present in `message.entities` or `message.caption_entities` (entity
     type `url` or `text_link`) → check `mediaFilter.link`
3. A single message could theoretically match more than one category (e.g. a photo
   with a link in its caption) — if ANY matching category's toggle is `true`, trigger
   the punishment once (don't punish twice for one message).
4. On a match: trigger the punishment (Part D).

## Part D — Punishment: delete + kick
Both filters share this exact punishment — implement it once as a shared function
both call (e.g. `applyRestrictionPunishment(ctx, chatId, userId, reason)`), don't
duplicate it:
1. Delete the offending message (`deleteMessage`), wrapped in try/catch — it may
   already be gone, that shouldn't block the next step.
2. Kick the user: `banChatMember` immediately followed by `unbanChatMember`, same
   pattern as Phase 3's captcha-timeout kick — this removes them but allows
   rejoining, it is not a permanent ban. Wrapped in try/catch.
3. Message in Group: show a message "Message Removed. Reason: [Reason]"
4. Post a log card via `postLogCard`:
   - Alphabet filter violations: tag `#ALPHABETKICK`
   - Media filter violations: tag `#MEDIAKICK`
   Both follow the same structural convention as `#FLOODMUTE`/`#CAPTCHAKICK`:
   `Admin: System (Auto-Moderation)`, `Chat:`, `User:`, `Reason:` (e.g. "message
   contained Arabic script (restricted)" or "sticker posting is restricted"), no
   `Count:` line, and — importantly — NO "Go to message" button, since the message
   that triggered this was just deleted and there's nothing left to link to. This
   format isn't locked in the way `#WARN`/`#TBAN`/`#BAN` are — flag it for review
   like the earlier automated-action tags were.
5. There is no DM notice to the kicked user in this phase (unlike warn/mute/ban) —
   not requested, don't add it speculatively. Flag it as a possible future addition
   if you think it's worth noting.
6. No escalation, no warning step first — every violation is an immediate delete +
   kick, per your instruction. This applies uniformly regardless of the user's prior
   history in the group.

## Part E — Retrofit the `/settings` menu (Phase 5)
Replace the "Under Development" toast handlers for "Alphabets" and "Media" with real
submenus:
- **Alphabets submenu**: six rows, one per script (Cyrillic, Arabic, CJK, Thai,
  Hebrew, Devanagari), each showing its current state (e.g. "🚫 Cyrillic: Restricted"
  / "✅ Cyrillic: Allowed") and toggling directly on tap — no separate "enable
  feature" step, tapping a row immediately flips that script's boolean via
  `setGroupSetting` and re-renders the submenu with the updated state. Include a
  "Back" button to return to the top-level menu.
- **Media submenu**: five rows, one per type (Photo, Video, Sticker, GIF, Link), same
  direct-toggle-on-tap pattern as above.
- This is a DIFFERENT interaction pattern from Part F's text/number-input
  conversation flow (Phase 5) — these are simple stateless toggle buttons, no
  conversation needed, just an inline keyboard callback handler per row.

## Explicitly out of scope for this pass
- Any percentage/majority-based detection threshold for the alphabet filter — ANY
  character triggers it, per your decision
- DM notice to the kicked user
- Standalone `/command` shortcuts for these toggles — menu-only, per Part A's framing
- Splitting stickers into static vs animated/video categories
- Scanning `edited_message` updates — only new messages are checked in this pass;
  flag if you think edited-message evasion (posting clean text, then editing in
  restricted content) is worth closing now vs. later

## Acceptance checklist
- [ ] All eleven toggles (6 alphabet + 5 media) default to `false` on a fresh deploy
- [ ] A message containing even one Cyrillic/Arabic/CJK/Thai/Hebrew/Devanagari
      character is deleted and the sender kicked ONLY when that specific script's
      toggle is `true` — confirm a message with the same script does NOT trigger
      anything while the toggle is `false`
- [ ] The alphabet filter also scans captions on media messages, not just plain text
- [ ] Posting a photo/video/sticker/GIF/link is deleted and the sender kicked ONLY
      when that specific media type's toggle is `true`
- [ ] A message matching multiple restricted categories at once (e.g. a restricted
      sticker... not applicable, but e.g. a photo with a restricted-link caption) is
      only punished once, not twice
- [ ] Admins and bots are fully exempt from both filters via `isAutoModerationExempt`
      — confirm with a real test where an admin posts content that would otherwise
      trigger a violation
- [ ] The kicked user can rejoin the group afterward (confirms it's a kick, not a
      permanent ban)
- [ ] `#ALPHABETKICK` and `#MEDIAKICK` log cards post correctly, with no "Go to
      message" button (since the source message is deleted) and "System
      (Auto-Moderation)" as the admin field
- [ ] The `/settings` menu's Alphabets and Media items now open real submenus with
      six and five independently-toggleable rows respectively, replacing the old
      "Under Development" toast — toggling a row updates Redis immediately and the
      submenu reflects the new state without needing to reopen it
- [ ] No DM is sent to the kicked user
- [ ] No percentage-based detection, no edited-message scanning, no standalone
      commands introduced

Report back with: which files changed/added, confirmation that the delete+kick
punishment is a single shared function used by both filters (not duplicated), the
exact Unicode ranges you used for each script, and the manual test steps you ran for
each of the 11 toggles — including at least one admin-exemption test and one
multi-category-match test (e.g. a photo with a link in its caption, both restricted).