Context: Phase 0, Phase 1, and the Logging Infrastructure pass are complete and
verified. `postLogCard(chatId, cardData)` already exists in middlewares/logger.ts and
correctly posts #WARN/#TBAN/#BAN cards to each group's configured log channel. Build
directly on top of all of it — reuse the existing mute mechanism, scheduler,
getGroupSettings, postLogCard, and Redis key conventions. Do not reimplement them.
Still no welcome messages or /settings menu — those remain later phases. Long polling
only, no webhook.

Implement Phase 2 of the roadmap: anti-spam and flood protection only.

## Part A — Flood guard

Design the punishment mechanism to be config-driven from day one, even though no UI
exists to change it until Phase 5. Concretely:

1. Extend `config/defaults.yaml` (and the per-group settings shape/type) with a
   `floodGuard` section:
```yaml
   floodGuard:
     enabled: true
     windowSeconds: 3
     messageThreshold: 5
     punishment:
       type: mute       # only 'mute' is implemented in this phase — see note below
       durationSeconds: 60
```
2. Implement `features/anti-spam/flood-guard.ts` as a grammY middleware:
   - On every text/media message in a group (skip DMs, skip admins — admins are
     exempt from flood punishment), record a timestamp in a Redis structure keyed
     per (chatId, userId) — a sorted set (ZADD with score = timestamp, member =
     unique message id or just timestamp) works well since you can ZREMRANGEBYSCORE
     to expire old entries and ZCARD to count within the window in one round trip.
   - If the count within `windowSeconds` exceeds `messageThreshold`: trigger
     punishment.
3. Punishment execution — per your instruction, this is auto-mute only, no warn:
   - Write a `applyFloodPunishment(ctx, chatId, userId, config)` function. For this
     phase, implement only the `mute` case, but structure it as a switch/dispatch on
     `punishment.type` (not an if-only-mute check) so Phase 5 can add `warn` | `kick`
     | `ban` as additional cases later without refactoring the call site.
   - Reuse the EXACT SAME mute mechanism from Phase 1 (`restrictChatMember` +
     scheduler-based auto-unmute) with `durationSeconds` from config (default 60s /
     1 minute). Do not duplicate mute logic — call into the same function Phase 1's
     `/mute` command uses internally, just triggered automatically instead of by an
     admin command.
   - Issuer for the log card and any DM notice is `'system'` / "Auto-Moderation", not
     a real admin — make sure `postLogCard` and any DM template handle this
     gracefully (no "undefined admin" text).
   - After punishing, reset/clear that user's flood counter for this chat so they
     aren't immediately re-punished the moment the mute lifts.
   - Post a `#FLOODMUTE` log card via the existing `postLogCard` helper. Follow the
     same structural conventions as the #WARN/#TBAN/#BAN cards: `Admin:` line reads
     as `System (Auto-Moderation)` rather than a real admin, `Reason:` reads
     something like "message rate exceeded {threshold} in {window}s", no `Count:`
     line (not applicable), and the same "Go to message" button pointing at whichever
     message tripped the threshold, if available. This exact format isn't locked in
     the way #WARN/#TBAN/#BAN are — flag it for review rather than treating it as final.
   - Optionally DM the muted user a brief notice (reuse Phase 1's DM patterns) — keep
     it short: flagged for sending messages too quickly, auto-muted for
     {durationSeconds}s. Wrap in try/catch like every other DM, per Phase 1 pattern.

## Part B — Basic rate limiting (lighter-weight, separate from flood guard)

- Add `@grammyjs/ratelimiter` as a simple per-user throttle sitting in front of the
  flood guard — this silently drops/ignores messages that come in faster than a
  small fixed window (e.g. more than 1 message per second sustained), purely to
  protect the bot process itself from being overwhelmed. This is NOT a moderation
  action, no log card, no DM, no mute — it's just self-protection. Keep the config
  for this hardcoded/simple (not part of the per-group settings system) since it's an
  infra concern, not a moderation policy.

## Explicitly out of scope for this pass
- Duplicate/near-duplicate message content detection
- Link filter / whitelist-domain logic
- Any /settings UI to change floodGuard config — the yaml/Redis shape must exist and
  be correct, but there is no admin-facing way to edit it yet (that's Phase 5)
- Any changes to `!setlogchannel`, `postLogCard`, or the #WARN/#TBAN/#BAN card format
  — that's already done; only add the new #FLOODMUTE card type on top of it
If you think either duplicate-detection or link-filter is trivial to bolt on now,
don't — flag it instead so we can scope it deliberately in a follow-up.

## Acceptance checklist
- [ ] Sending messages faster than the configured threshold (default: 5 messages in
      3 seconds) in a real test group triggers an automatic 1-minute mute
- [ ] The flooding user is NOT warned (no warn count incremented) — only muted
- [ ] Flood auto-mute posts a `#FLOODMUTE` card via the existing `postLogCard`
      (flagged as a new, unconfirmed format) with "System (Auto-Moderation)" as the
      admin field
- [ ] An admin account is exempt from flood punishment even if they trip the same
      message rate
- [ ] The flood mute auto-lifts after 60s via the existing Phase 1 scheduler, with no
      new/duplicate scheduler implementation
- [ ] Flood counter resets after punishment so the user isn't instantly re-muted the
      moment the first mute ends
- [ ] Punishment logic is structured so a future `warn`/`kick`/`ban` punishment type
      could be added by extending a switch/dispatch, not by rewriting the call site
- [ ] The lightweight rate limiter (Part B) does not post logs, DM anyone, or mute —
      confirm it's clearly separate from the flood-guard moderation logic
- [ ] No duplicate-message detection, link filter, or /settings UI introduced
- [ ] No changes made to `!setlogchannel` or the #WARN/#TBAN/#BAN card format from
      the prior pass

Report back with: which files changed/added, the exact Redis structure used for the
flood window counter (and why you chose it), and the manual test steps you ran to
trigger and verify the flood auto-mute.