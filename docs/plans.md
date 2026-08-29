Feature Roadmap
 
### Phase 0 — Foundation (infra, no bot logic yet)
- Repo scaffold per structure above
- grammY bot boots, connects via long polling (webhook optional later)
- Redis connection + health check
- i18n plugin wired with `en.json` / `id.json`, per-group locale stored in Redis
- Unified command parser middleware: normalizes `/warn` and `!warn` to the same handler
- Admin-guard middleware: fetches `getChatAdministrators`, caches in Redis (short TTL)
- Bot running locally against native Redis; PM2 config verified with a real `pm2 start`
  on a low-memory box (or a local memory-capped test) before moving on
### Phase 1 — Core Moderation (MVP)
- `/warn` `!warn` — increments Redis counter per (chat_id, user_id); default threshold 5
  - Custom message support: admin can attach an optional message directly in the command without quotes.
  - Includes a `➖ Remove Warning (-1)` button for admins.
- `/mute` `!mute` — restrictChatMember (mute), mandatory duration via `time-parser`
- `/tban` `!tban` — banChatMember + scheduled unban via Redis Sorted Set + auto-unban worker
- `/ban` `!ban` — permanent banChatMember
- All actions: validate sender is admin, validate target isn't an admin/immune,
  write to log channel (with `<Display Name> [<user_id>]` formatting), attempt DM notification to the affected user with a "Rejoin Group" link for unbans/expirations.
- Log channel config per group (`/settings` stub: set log channel ID)
- `@username` resolution support via `username-tracker` middleware with a 7-day TTL in Redis.
### Phase 2 — Anti-Spam & Anti-Flood
- Rate limiter via `@grammyjs/ratelimiter`: message-per-second throttling
- Flood guard: N messages within X seconds → auto-mute + warn
- Duplicate/near-duplicate message detection (simple hash or Levenshtein on recent
  message cache in Redis)
- Link filter (toggle in settings): blocks/flags messages containing links unless
  sender is admin or link is whitelisted domain
- Configurable thresholds per group, defaults from YAML
### Phase 3 — Welcome / Goodbye
- On new member join: send welcome message (templated, i18n, supports placeholders
  like `{username}`, `{group_name}`)
- Optional captcha gate before user can send messages (simple button-tap challenge;
  auto-kick if not solved within timeout) — maps to the "Captcha" menu item
- On member leave: optional goodbye message
- Both togglable per group via settings
### Phase 4 — Mentions & Relay
- `@admin` detection (case-insensitive, word-boundary match) → forwards the triggering
  message to every group admin's DM, one by one, with sender/context info; gracefully
  skips admins who haven't started the bot (catch `Forbidden: bot was blocked` etc.)
- `@username` mention detection → resolve username to user_id via the Redis
  username↔user_id map (populated as users interact with the bot); if resolvable and
  the user has started the bot, DM them a "You were mentioned" notice with an inline
  button deep-linking back to the group chat
- Both features respect a per-group on/off toggle (spam-prevention for large groups)
### Phase 5 — `/settings` DM Control Panel (Admin-Only)
- Admin runs `/settings` in group → bot DMs them (must have started the bot first;
  otherwise prompts them to start it)
- Admin runs `/settings` in DM → bot asked which group to select, verify if both user and bot are admin on that group before creating option buttons.
- Inline menu via `@grammyjs/menu`, matching the reference UI: Custom Name, Rules,
  Moderation (Toggle on/off for warn/tban/ban(include unban)/mute(include unmute), and set warn threshold), Anti-Spam, Anti-Flood, Welcome, Goodbye, Alphabets, Captcha, Check, @Admin, Tag (mention user), Media, Porn,
  Lang, Resolution Group, Tutup
- Header image attached (static asset, sent via `sendPhoto` with the menu as caption
  keyboard)
- Each menu item opens a sub-menu (toggle on/off, set thresholds, edit message
  templates) — build incrementally, starting with the items already implemented in
  earlier phases (Peraturan/Rules, Sambutan/Welcome, Anti-Spam, Anti-Flood, Peringatan/
  Warn threshold, Lang), if not yet implemented display "Under Development" for menu Check, Resolution Group, etc
- Non-admins attempting `/settings` get a polite denial
### Phase 6 — Extended Moderation Settings (stretch)
- Abjad (alphabet/script filter — e.g. restrict non-Latin spam scripts)
- Media restrictions (restrict photo/video/sticker/GIF posting to admins-only mode)
### Phase 7 — Hardening & Ops
- Unit tests for command parser, permission checks, time-parser, threshold logic
- Integration tests using grammY's test transformer / mocked Bot API
- Rate-limit and abuse protection on `/settings` and mention-relay to prevent DM spam
- Structured audit log retention policy in Redis (or periodic export to file)
- Deployment runbook: `pm2 start ecosystem.config.js`, `pm2 save` + `pm2 startup` for
  boot persistence, backup strategy for Redis AOF/RDB, memory monitoring
  (`pm2 monit` / `free -m`) and a documented restart procedure
- Monitoring: basic uptime/health endpoint, error alerting to a dedicated ops channel,
  and a simple periodic check that resident memory stays within the 768MB budget
---
 
### Suggested build order
Phase 0 → 1 → 2 → 3 → 4 → 5 (basic) → 7 (baseline tests early, not only at the end) → 6 (extended settings, iterative).
Ship Phases 0–2 as your first working release; that alone covers warn/mute/tban/ban, anti-spam, and logging — the highest-value moderation core.