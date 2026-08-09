Context: `npm run dev` already runs successfully in this repo. Webhook setup is
explicitly out of scope for now — use long polling only (grammY runner, `run(bot)`).
Do not add any webhook server, Express app, or HTTP listener at this stage.

Implement Phase 0 of the roadmap: foundation only. No moderation commands, no
anti-spam, no welcome messages, no settings menu yet — those are later phases.
Scope creep into later phases should be flagged, not silently implemented.

## Deliverables for this pass

1. Project structure
   Create/confirm the following under src/, using placeholder/TODO content only where
   a file's real logic belongs to a later phase:
   - config/env.ts        → zod-validated typed loader for BOT_TOKEN, REDIS_URL,
                             DEFAULT_LOCALE, NODE_ENV, LOG_LEVEL. Fail fast with a
                             clear error message if required vars are missing.
   - config/defaults.yaml  → skeleton per-group default settings object (locale,
                             warnThreshold: 5, logChannelId: null, features: {} —
                             just enough shape for later phases to extend)
   - i18n/en.json, i18n/id.json → at minimum a few real strings: a startup greeting,
                             a generic error message, and a "pong"/health-check
                             string. Wire these through @grammyjs/i18n, not hardcoded.
   - db/redis.ts           → single Redis client instance (ioredis), connecting to
                             REDIS_URL (native host Redis, no container). Export a
                             connect() that logs success/failure and a healthcheck()
                             function.
   - db/keys.ts            → central key-naming helper, e.g.
                             warnKey(chatId, userId) => `warn:${chatId}:${userId}`
                             groupSettingsKey(chatId) => `group:${chatId}:settings`
                             Establish the naming convention now so later phases don't
                             invent inconsistent key formats.
   - middlewares/command-parser.ts → grammY middleware that treats a message starting
                             with "!" the same as one starting with "/". Concretely:
                             detect `!word args...` at the start of a text message and
                             rewrite/expose it so existing grammY `bot.command()`
                             handlers fire identically for "/warn" and "!warn". Write
                             this generically — it must work for every future command
                             name without per-command wiring.
   - middlewares/admin-guard.ts → exposes a reusable `isGroupAdmin(ctx)` check. Calls
                             `getChatAdministrators`, caches the admin id list in
                             Redis with a short TTL (e.g. 5 minutes) keyed per chat,
                             refetches on cache miss. Export both the raw check
                             function and a ready-to-use grammY middleware factory
                             (e.g. `requireAdmin()`) for later phases to attach to
                             moderation commands.
   - middlewares/group-settings.ts → loads a merged settings object onto
                             `ctx.groupSettings` for group chats: Redis override
                             merged over defaults.yaml. Stub is fine — full
                             read/write logic belongs to Phase 5, but the accessor
                             function `getGroupSettings(chatId)` must exist and be
                             correct now, since every later phase depends on it.
   - types/context.ts      → extended grammY Context type including: i18n (translate
                             function), session (empty/minimal shape for now),
                             groupSettings (the merged settings object)
   - bot.ts                → instantiate the Bot, install i18n plugin, install the
                             command-parser and group-settings middlewares in the
                             correct order, register a `/start` handler (DM) and a
                             `/ping` or `!ping` handler (group + DM) that replies with
                             the i18n "pong" string — this is your smoke test for the
                             command-parser working correctly.
   - index.ts              → entrypoint: load env, connect Redis (exit process with a
                             clear log message if it fails to connect), start the bot
                             via grammY runner (long polling), wire graceful shutdown
                             on SIGINT/SIGTERM (stop the runner, disconnect Redis).

2. PM2 config (prepare, don't need to fully deploy yet)
   - ecosystem.config.js per the earlier spec: fork mode, `--max-old-space-size=256`,
     `max_memory_restart: '300M'`. This doesn't need to run on the real VPS in this
     pass — just have it ready and documented in the README.

3. README updates
   - How to run locally (`npm run dev`, confirm still works after these changes)
   - How Redis connection is configured (native host Redis, REDIS_URL env var)
   - How the "/cmd vs !cmd" parser works, with an example
   - Note explicitly: webhook mode is not implemented, long polling only, by design
     for now

## Acceptance checklist (verify before considering this pass done)
- [ ] `npm run dev` still starts cleanly with no errors
- [ ] Bot responds to `/start` in a DM with the i18n greeting
- [ ] Bot responds to both `/ping` and `!ping` (group and DM) with the same reply,
      proving the command-parser middleware works for both prefixes
- [ ] Redis connection is verified on startup (log confirms connect, or process exits
      with a clear error if Redis is unreachable — do not fail silently)
- [ ] Switching DEFAULT_LOCALE (or a per-chat override, if trivial to stub) changes
      the reply language between en/id
- [ ] `isGroupAdmin(ctx)` correctly identifies an admin vs non-admin in a real test
      group (manually verify with your own Telegram admin account)
- [ ] No webhook code, no HTTP server, no Express dependency introduced
- [ ] No moderation commands (warn/mute/tban/ban), anti-spam, welcome messages, or
      settings menu implemented yet — flag explicitly if you were tempted to add any

Report back with: which files changed, any deviations from this spec and why, and the
manual test steps you ran to confirm the checklist above.