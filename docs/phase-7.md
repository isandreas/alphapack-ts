Context: Phase 0 through Phase 6 are complete and verified. This is a hardening/ops
pass, not a new feature pass — the goal is tests, abuse protection, operational
visibility, and a real deployment runbook, layered on top of everything that already
exists. Do not modify existing feature behavior beyond what's specified here. Long
polling only, no webhook, no HTTP server of any kind (this remains true even for the
health check — see Part B).

## Part A — New env vars for this phase
Add to `config/env.ts`'s validated schema:
- `OPS_CHANNEL_ID` (optional, numeric, nullable) — a SINGLE global Telegram channel
  for the bot OPERATOR (you), used for crash/error alerts and memory warnings. This
  is intentionally different from the per-group `!setlogchannel` mechanism from the
  Logging Infrastructure pass — that one is per-group moderation history, configured
  by each group's admins; this one is bot-operational health, configured once by
  whoever runs the bot. If unset, skip alerting silently (same "no error if
  unconfigured" pattern used everywhere else in this project).
- `OWNER_ID` (optional, single numeric Telegram user id) — the only person allowed to
  run `/health` (Part B). This is deliberately a single id, not a list, and
  deliberately NOT tied to group-admin status — group admins should not see internal
  technical diagnostics (memory usage, Redis connectivity, scheduler internals) as
  part of their normal admin experience. If unset, `/health` refuses everyone.
- `AUDIT_LOG_RETENTION_DAYS` (optional, numeric, default `30`) — see Part D.

## Part B — `/health` command (DM only, owner-only, NOT an HTTP endpoint)
Per your direction, "health check" here means a Telegram command, not a web server,
and it's restricted to you specifically — not group admins in general, since this
exposes internal technical details admins have no reason to see:
1. DM-only, refuse in groups with a clear i18n message.
2. Access check: `ctx.from.id === env.OWNER_ID`. Anyone else — including verified
   group admins — gets the same generic "not authorized" denial, without confirming
   or denying that the command does anything special (don't leak that a privileged
   command exists). If `OWNER_ID` is unset, refuse everyone unconditionally.
3. Per-user cooldown: 60 seconds between uses (Redis key with TTL, same lightweight
   pattern as every other cooldown in this project). On cooldown, reply with a brief
   i18n cooldown notice rather than silently ignoring — this is a diagnostic command
   you might genuinely retry, so a clear "try again in Xs" is more useful here than
   silence.
4. Reply with a compact status report:
   - Process uptime (human-readable, e.g. "3d 4h 12m")
   - Memory usage: current RSS and heap used, compared against the
     `--max-old-space-size` cap from the PM2 ecosystem config (flag if usage is
     approaching the cap, e.g. >80%)
   - Redis connectivity: a live `PING` check, not just "assumed connected"
   - Node.js version and environment (`NODE_ENV`)
   - Last time the scheduled-action sweep (Phase 1/2/3) actually ran, so you can spot
     a silently-stalled scheduler
4. This is a manual, on-demand check — it does not run automatically. Automatic
   monitoring is Part C.

## Part C — Ops channel alerting
1. Global error handling: hook into grammY's `bot.catch()` for errors thrown inside
   middleware, AND Node's `process.on('unhandledRejection')` /
   `process.on('uncaughtException')` for anything outside grammY's own handling. On
   any of these, post a concise error summary (error message + a short stack
   excerpt, NOT a full dump — keep it readable) to `OPS_CHANNEL_ID` if configured.
   Still log the FULL error via pino to stdout/PM2 logs regardless of whether
   `OPS_CHANNEL_ID` is set — the channel is a convenience alert, not the only record.
2. Rate-limit the alerts themselves: if the same error keeps recurring in a tight
   loop, do not spam the ops channel once per occurrence — collapse repeats within a
   short window (e.g. one alert per distinct error message per 5 minutes) so a
   crash-loop doesn't itself become a flood problem.
3. Memory monitoring: on an interval (e.g. every 5 minutes — reuse the existing
   scheduler/sweep cadence infrastructure if convenient, or a simple separate
   `setInterval`), check `process.memoryUsage().rss` against a threshold (e.g. 80% of
   the configured `--max-old-space-size`). If exceeded, log a warning AND post to
   `OPS_CHANNEL_ID` (same per-alert cooldown as above — don't re-alert every 5
   minutes while still over threshold, once per hour is enough).
4. All of this must degrade gracefully with `OPS_CHANNEL_ID` unset: full pino
   logging still happens, just no Telegram alert.

## Part D — Audit log: flat JSON files, not Redis
Per your direction, this is a local backup/debugging trail independent of Redis and
independent of the per-group Telegram log channels (which remain the primary
human-facing audit trail — this is a supplementary raw record):
1. Extend the existing `postLogCard` helper (Logging Infrastructure pass): every time
   it's called, in addition to posting to the group's Telegram log channel, append
   the same `cardData` object as one line of JSON (JSONL format) to a local file
   under something like `logs/audit/{YYYY-MM-DD}.jsonl` (one file per day, based on
   the action's timestamp). This means the write happens in real time as actions
   occur — "periodic" refers to the retention/cleanup cadence (below), not to
   batching the writes themselves.
2. Retention: once a day (e.g. alongside the existing scheduler sweep, or its own
   simple daily interval), delete any audit log file older than
   `AUDIT_LOG_RETENTION_DAYS` (default 30). Base this on the filename's date, not
   filesystem mtime, so it's predictable.
3. This is disk-based, not Redis-based, specifically so it doesn't consume any of the
   VPS's 768MB RAM budget — flag clearly in your implementation notes that this
   trades RAM for disk, and note the expected disk footprint isn't a concern at this
   project's scale (small groups, low message volume) but would need revisiting if
   usage grew substantially.
4. No new admin-facing command to browse these files in this pass — they're meant for
   you (the operator) to `cat`/`grep` directly on the VPS if ever needed. Don't build
   a `/auditlog` command speculatively.

## Part E — Rate-limit and abuse protection
1. `/settings`: add a per-user cooldown (e.g. 3–5 seconds between invocations) to
   prevent someone rapidly re-triggering it — each invocation does real work (admin
   verification across potentially several groups, menu rendering), so this protects
   both Telegram API usage and your VPS's limited resources. Also apply a light
   cooldown to the menu's "Edit" button taps (Phase 5, Part F's conversation trigger)
   for the same reason — don't let someone spam-open text-input prompts.
2. Mention-relay (`@admin` / `@username`, Phase 4): the per-feature cooldowns already
   built (`cooldownSeconds`) handle repeated triggering. This phase adds one more
   layer: when relaying to MULTIPLE admins in one `@admin` trigger, or handling
   multiple mentions in one message, add a small explicit delay between consecutive
   outgoing `sendMessage`/`forwardMessage` calls (e.g. 50–100ms) rather than firing
   them all instantly — this respects Telegram's own per-bot rate limits (roughly 30
   messages/second globally, 1/second to the same chat) and avoids triggering 429
   "Too Many Requests" errors when a group has many admins. If a 429 is still
   received, respect its `retry_after` value and back off accordingly rather than
   immediately retrying.
3. Do not introduce any NEW per-group configurable settings in this phase — these are
   fixed, sensible engineering safeguards, not admin-configurable policy.

## Part F — Unit tests
Use a lightweight TypeScript-native test runner — Vitest is a good fit here (fast,
low overhead, minimal config) — flag if you'd rather use something else. Cover:
- Command-parser: `/cmd` and `!cmd` normalization, including edge cases (extra
  whitespace, mixed case, no arguments, malformed input)
- Permission checks: `isGroupAdmin`, `requireAdmin()`, `isModerationFeatureEnabled`,
  `isAutoModerationExempt` — mock the underlying Telegram API calls, don't hit real
  Telegram
- Time-parser: valid formats (`10m`, `2h`, `1d`) and invalid ones (garbage input,
  negative numbers, zero)
- Threshold logic: warn count vs `warnThreshold`, including the exact boundary (count
  == threshold triggers escalation, count == threshold - 1 does not)

## Part G — Integration tests
- Use grammY's API transformer mechanism to intercept outgoing Bot API calls (e.g.
  `banChatMember`, `sendMessage`, `restrictChatMember`) during tests, so you can
  assert on what the bot WOULD have done without making real Telegram API calls or
  needing a live bot token in CI.
- Cover at least: a full warn-to-auto-ban escalation sequence, a flood-guard trigger
  and its auto-mute, and the `!setlogchannel` flow's channel-verification step
  (mocking `getChatMember` to simulate both the bot-has-permission and
  bot-lacks-permission cases).
- These don't need to be exhaustive across every feature — the goal is confidence in
  the trickiest cross-cutting flows (escalation, scheduling, permission verification),
  not 100% coverage.

## Part H — Deployment runbook (README section)
Document, with exact commands:
- Starting in production: `pm2 start ecosystem.config.js`, `pm2 save`,
  `pm2 startup` (and actually running the systemd command it prints out)
- Redis backup strategy: how AOF/RDB persistence is configured on this VPS
  (document what's already there — don't reconfigure Redis itself, that's outside
  this bot's setup), and a simple manual `redis-cli BGSAVE` note for on-demand
  backups before risky changes
- Memory monitoring commands: `pm2 monit`, `free -m`, and how to interpret them
  against the 768MB budget
- Restart procedure: `pm2 restart <name>`, and when to prefer `pm2 reload` (zero
  downtime) vs `pm2 restart`
- How to read the new audit log files (Part D) and check `OPS_CHANNEL_ID` alerts
- A short "if the bot seems stuck" troubleshooting checklist: check `pm2 logs`, check
  `/health` via DM, check Redis connectivity, check disk space for the audit logs

## Explicitly out of scope for this pass
- Any HTTP server, health endpoint, or webhook — `/health` is a DM command, full stop
- A `/auditlog` browsing command
- New per-group configurable rate-limit settings — Part E's protections are fixed
- 100% test coverage — Parts F/G target the highest-risk logic, not everything

## Acceptance checklist
- [ ] `/health` works only in DM, only for the single user id in `OWNER_ID`, and
      reports uptime, memory vs the PM2 memory cap, live Redis connectivity, and
      last scheduler run time
- [ ] `/health` enforces a 60-second cooldown for that owner, replying with a clear
      "try again in Xs" message rather than silently ignoring repeated attempts
- [ ] A verified group admin who is NOT the configured `OWNER_ID` is refused
      `/health` just like anyone else — admin status alone does not grant access
- [ ] With `OWNER_ID` unset, `/health` refuses everyone unconditionally
- [ ] A deliberately thrown error (e.g. a temporary test throw) results in a concise
      alert in `OPS_CHANNEL_ID`, without a full raw stack dump, while the full error
      still appears in pino/PM2 logs
- [ ] Repeating the same error rapidly does NOT flood the ops channel — confirm the
      per-error cooldown works
- [ ] Simulating high memory usage (or lowering the threshold for a test) triggers
      exactly one ops-channel alert, not a repeat every interval
- [ ] With `OPS_CHANNEL_ID` unset, all of the above still logs correctly via pino,
      with no crash from the missing channel
- [ ] Every `postLogCard` call now also appends a line to the correct day's
      `logs/audit/{date}.jsonl` file, matching the same `cardData` posted to Telegram
- [ ] Audit log files older than `AUDIT_LOG_RETENTION_DAYS` are correctly pruned by
      the daily cleanup, based on filename date
- [ ] `/settings` is throttled against rapid repeated invocation by the same user
- [ ] A simulated `@admin` relay to several admins sends with small pacing between
      calls rather than all at once, and correctly backs off on a simulated 429
- [ ] Unit tests pass for command-parser, permission checks, time-parser, and
      threshold boundary logic (including the exact `count == threshold` edge case)
- [ ] Integration tests pass for the warn-to-ban escalation, flood-guard auto-mute,
      and `!setlogchannel` permission-verification flows, using grammY's transformer
      to mock the Bot API — no real Telegram calls made during tests
- [ ] README's deployment runbook section is complete and every command in it has
      actually been run once against the real VPS to confirm it works as documented
- [ ] No HTTP server or webhook of any kind was introduced anywhere in this pass

Report back with: which files changed/added, your test framework choice and how you
mocked the Bot API for integration tests, the exact error/memory alert cooldown
values you used, confirmation that the audit log write is piggybacking on the
existing `postLogCard` call site rather than a parallel logging path, and the actual
output of running through the deployment runbook once end-to-end on the real VPS.