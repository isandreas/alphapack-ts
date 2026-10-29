Context: Phase 0 through Phase 6 and Phase 7a (Observability & Ops) are complete and
verified. This pass adds fixed engineering safeguards against abuse/overload on two
specific surfaces: `/settings` and the mention-relay features — plus a settings-change
audit trail for the `/settings` menu, and a small scoped dead-code cleanup in the
mention-relay area. It does NOT touch `/health`, ops alerting, the audit log, tests, or
deployment docs — those are separate passes. Do not introduce any new per-group
configurable settings here — these are fixed safeguards, not admin-configurable
policy.

## Part A — `/settings` throttling + settings-change logging
1. Add a per-user cooldown (e.g. 3–5 seconds between invocations) on `/settings`
   itself, to prevent someone rapidly re-triggering it — each invocation does real
   work (admin verification across potentially several groups, menu rendering), so
   this protects both Telegram API usage and your VPS's limited resources.
2. Also apply a light cooldown to the menu's "Edit" button taps (Phase 5, Part F's
   conversation trigger) for the same reason — don't let someone spam-open
   text-input prompts.
3. On cooldown, reply with a brief i18n cooldown notice (or an ephemeral callback
   toast, if triggered via a button) rather than silently ignoring the tap.
4. **New — log every setting change made through the `/settings` menu**, so each
   group's log channel shows a record of who changed what, not just moderation
   actions. Scope this specifically to the MENU — standalone commands from earlier
   phases (`/setwelcome`, `/captcha on|off`, `/adminmention on|off`, etc.) are
   unaffected and remain unlogged, per how they were originally specified.
   - Add a thin wrapper, e.g. `setGroupSettingViaMenu(chatId, key, newValue, ctx)`,
     used ONLY by `/settings` menu button/conversation handlers (Phase 5 and Phase 6)
     in place of calling `setGroupSetting` directly. Internally it: reads the current
     value via `getGroupSettings` BEFORE writing (so it can report old → new), calls
     the existing `setGroupSetting` to persist the change, then posts a log card via
     `postLogCard` with a new `#SETTINGSCHANGE` tag: `Admin: <name> (<id>)`,
     `Chat: <group>`, `Setting: <key>`, `From: <old>`, `To: <new>` — no "Go to
     message" button (there's no source message).
   - For free-text settings (Custom Name, Rules text, Welcome/Goodbye templates):
     don't log the full before/after text verbatim (could be long and clutter the
     channel) — just note that the template was updated (e.g. `Setting: Welcome
     template`, `Change: updated` — omit `From`/`To` content, or truncate to ~30
     chars with an ellipsis if you'd rather show a hint of the change).
   - For the Moderation submenu's "Enable All" / "Disable All" shortcut (Phase 5,
     Part A3): post ONE combined log card summarizing all four toggles changing
     together (e.g. `Setting: Moderation (warn, tban, ban, mute)`, `To: ENABLED`),
     not four separate cards — avoid spamming the log channel for a single bulk
     action.
   - This means retrofitting every existing `/settings` menu handler from Phase 5
     (Custom Name, Rules, Moderation toggles + threshold + Enable/Disable All,
     Anti-Flood, Welcome, Goodbye, Captcha, @Admin, Tag, Lang, Resolution Group) and
     Phase 6 (the 6 alphabet toggles, 5 media toggles) to call the new wrapper
     instead of `setGroupSetting` directly. This is a retrofit across two already-
     written phases — call it out clearly in your report so it's easy to review.
   - Like every other log card in this project, this respects "no log channel
     configured → skip silently" — don't error if a group hasn't run
     `!setlogchannel`.

## Part B — Mention-relay pacing, plus a dead-code pass over this area
1. The per-feature cooldowns already built in Phase 4 (`cooldownSeconds` for both
   `@admin` and `@username`) already handle repeated triggering by the same user —
   don't rebuild that here.
2. This pass adds one more layer: when relaying to MULTIPLE admins in one `@admin`
   trigger, or handling multiple mentions in one message, add a small explicit delay
   between consecutive outgoing `sendMessage`/`forwardMessage` calls (e.g. 50–100ms)
   rather than firing them all instantly — this respects Telegram's own per-bot rate
   limits (roughly 30 messages/second globally, 1/second to the same chat) and
   avoids triggering 429 "Too Many Requests" errors when a group has many admins.
3. If a 429 is still received despite the pacing, respect its `retry_after` value and
   back off accordingly rather than immediately retrying.
4. **New — while you're in this area, do a focused dead-code cleanup pass**, scoped
   to the mention-relay/report-resolve files touched across Phase 4 and this pass
   (admin-relay, user-mention-notify, report-resolve, the username registry, and
   cooldown helpers) — NOT a repo-wide refactor, just this area:
   - Remove unused imports, unreachable branches, leftover `console.log`/debug
     statements, and commented-out old code left over from earlier iterations.
   - Look for functions or exports that were superseded across phases (e.g. if an
     earlier draft of the report-resolve logic left behind a helper no longer called
     after later refinements) and remove them if genuinely unused — a quick
     `tsc --noUnusedLocals` or an ESLint `no-unused-vars` pass is enough to surface
     candidates, don't hand-audit line by line.
   - If anything looks unused but you're not fully sure it's safe to delete (e.g. it
     might be referenced dynamically, or you're unsure if another phase's code calls
     it), flag it in your report instead of deleting it — don't guess on this.

## Explicitly out of scope for this pass
- Any new per-group configurable rate-limit settings — these are fixed safeguards
- Changes to `/health`, ops alerting, or the audit log — that's Section 11
- Tests and deployment docs — that's Section 13
- A repo-wide dead-code sweep — Part B's cleanup is scoped to the mention-relay area
  only

## Acceptance checklist
- [ ] `/settings` is throttled against rapid repeated invocation by the same user,
      with a clear cooldown message rather than silent ignoring
- [ ] The menu's "Edit" button similarly resists rapid repeated taps
- [ ] Changing a toggle via the `/settings` menu (e.g. Welcome on/off) posts a
      `#SETTINGSCHANGE` log card to the group's configured log channel, showing the
      admin, the setting, and the old/new value
- [ ] Changing a free-text setting (e.g. Custom Name) logs that it changed WITHOUT
      dumping the full old/new text verbatim
- [ ] Using "Enable All" / "Disable All" in the Moderation submenu posts ONE combined
      log card, not four separate ones
- [ ] The SAME toggle changed via a standalone command (e.g. `/captcha on|off`, not
      through the menu) does NOT post a `#SETTINGSCHANGE` card — confirm this
      distinction is real, not accidentally logging everything
- [ ] With no log channel configured for a group, menu changes still work correctly
      and simply don't post anything — no error
- [ ] A simulated `@admin` relay to several admins sends with small pacing between
      calls rather than all at once
- [ ] A simulated 429 response during relay correctly triggers a `retry_after`-based
      backoff rather than an immediate retry
- [ ] The mention-relay/report-resolve files have been checked for unused imports,
      dead functions, and leftover debug code, with anything ambiguous flagged
      rather than deleted
- [ ] No new per-group settings were introduced

Report back with: which files changed/added, confirmation of every Phase 5/6 menu
handler you retrofitted to use `setGroupSettingViaMenu` (list them), the exact
cooldown/pacing values you used, what dead code (if any) you found and removed vs.
flagged for review, and the manual test steps you ran (including how you simulated a
429, if you were able to).