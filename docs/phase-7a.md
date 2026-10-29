Context: Phase 0 through Phase 6 are complete and verified. This pass adds
operational visibility only: a `/health` command, error/memory alerting to a
dedicated ops channel, and a local audit log. It does NOT touch rate-limiting/abuse
protection or tests/deployment docs — those are separate passes. Do not modify
existing feature behavior beyond what's specified here. Long polling only, no
webhook, no HTTP server of any kind (this remains true even for the health check —
see Part B).

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
5. This is a manual, on-demand check — it does not run automatically. Automatic
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

## Explicitly out of scope for this pass
- Any HTTP server, health endpoint, or webhook — `/health` is a DM command, full stop
- A `/auditlog` browsing command
- Rate-limiting/abuse protection on `/settings` or mention-relay — that's Section 12
- Unit/integration tests and the deployment runbook — that's Section 13

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
- [ ] No HTTP server or webhook of any kind was introduced anywhere in this pass

Report back with: which files changed/added, the exact error/memory alert cooldown
values you used, and confirmation that the audit log write is piggybacking on the
existing `postLogCard` call site rather than a parallel logging path.