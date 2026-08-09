You are setting up a production-grade Telegram group management bot in TypeScript.
Follow this spec exactly. Ask before deviating from any architectural decision below.

## VPS Constraints — read this before making infra choices
Target production host has **768MB total RAM**, with Redis already installed and running
natively on it. Given this:
- Do NOT containerize anything for production. No Docker, no docker-compose, no
  dockerd/containerd overhead (that alone can consume 80–150MB idle on a box this size).
- Do NOT run a second Redis instance. Connect to the VPS's existing native
  `redis-server` via `REDIS_URL=redis://127.0.0.1:6379` (or the appropriate socket).
- The bot must run as a single lean Node.js process, memory-capped explicitly
  (`node --max-old-space-size=256 dist/index.js` or equivalent PM2 config), to leave
  headroom for the OS and Redis.
- Favor low-memory-footprint choices throughout: avoid heavy in-memory caches beyond
  what Redis already provides, stream/paginate rather than loading full datasets,
  and keep dependency count lean.
- Recommend the VPS operator add a swap file (512MB–1GB) as OOM insurance — mention
  this in the README but it is outside the bot's own setup.

## Tech Stack
- Runtime: Node.js 20+, TypeScript (strict mode)
- Bot framework: grammY
  - @grammyjs/i18n (Bahasa Indonesia + English)
  - @grammyjs/conversations (multi-step flows, e.g. custom warn/ban message input)
  - @grammyjs/menu (inline keyboard settings panel)
  - @grammyjs/ratelimiter (anti-spam/flood throttling)
  - @grammyjs/storage-redis (session storage adapter)
  - grammY runner (grammy/runner) for long-polling with graceful concurrency
- State storage:
  - Redis (native, already installed on the VPS — NOT containerized): warn counts,
    mute/ban state cache, flood/rate counters, per-group runtime settings,
    username→user_id resolution map, session data
  - JSON/YAML files (per-group, git-ignored, plain filesystem — no volume mounts
    needed since there's no container): default settings template, static
    translation strings (en.json / id.json), fallback config when Redis is cold
- Persistence: rely on the VPS's existing Redis AOF/RDB configuration (already
  installed — do not reconfigure persistence settings as part of this bot's setup
  unless asked).
- Deployment: bare Node.js process managed by **PM2** (auto-restart, log rotation,
  `pm2 startup` for boot persistence), `.env` for secrets. A `Dockerfile` may be kept
  for local dev parity only — it is not used in production on this VPS.
- Logging: pino (structured JSON logs to stdout, captured by PM2) + a dedicated
  Telegram log channel per group

## Project Structure
src/
  bot.ts                  # bot instantiation, middleware wiring
  index.ts                # entrypoint, runner bootstrap, graceful shutdown
  config/
    env.ts                # typed env var loader (zod-validated)
    defaults.yaml          # default per-group settings template
  i18n/
    en.json
    id.json
  db/
    redis.ts               # redis client singleton
    keys.ts                # centralized Redis key naming (namespacing per chat_id)
  middlewares/
    command-parser.ts      # unifies "/cmd" and "!cmd" into one command context
    admin-guard.ts          # verifies sender is group admin before mod actions
    group-settings.ts       # loads per-group settings into ctx before handlers
    anti-spam.ts             # flood/rate-limit + duplicate-message detection
    logger.ts                # per-action audit logger → log channel
  features/
    moderation/
      warn.ts               # /warn, !warn + threshold→autoban logic
      mute.ts                # /mute, !mute
      tban.ts                # /tban, !tban (temporary ban w/ scheduled unban)
      ban.ts                 # /ban, !ban
    anti-spam/
      flood-guard.ts
      link-filter.ts
    welcome/
      on-join.ts
      on-leave.ts
    mentions/
      admin-mention.ts       # "@admin" → relay to all admins' DMs
      user-mention.ts        # "@username" → notify DM w/ deep-link button
    settings/
      settings-menu.ts       # /settings DM-only inline menu (grammY menu plugin)
      settings-panel-image.ts
    scheduler/
      unban-scheduler.ts     # handles tban expiry (Redis TTL + BullMQ or node-cron)
  types/
    context.ts              # extended grammY Context type (i18n, session, group settings)
  utils/
    permissions.ts
    time-parser.ts           # parses "10m", "2h", "1d" for tban/mute durations
    deep-link.ts              # builds t.me deep links

## Coding Conventions
- Strict TypeScript, no `any` without justification
- All Telegram API calls wrapped with try/catch and typed error handling
  (grammY throws GrammyError / HttpError — handle both)
- All user-facing strings routed through i18n — no hardcoded text in handlers
- Per-group settings always read through a single `getGroupSettings(chatId)` accessor
  that merges: Redis override → YAML defaults
- Command handlers must work identically whether triggered by "/cmd" or "!cmd"
- Every moderation action (warn/mute/tban/ban/unban) must:
  1. Persist state to Redis
  2. Emit a structured log entry
  3. Post a formatted action card to the group's configured log channel
  4. DM the target user when applicable (with graceful failure if DM is blocked)

## Environment Variables (.env)
BOT_TOKEN=
REDIS_URL=
DEFAULT_LOCALE=id
NODE_ENV=production
LOG_LEVEL=info

## Deployment (PM2, no Docker)
Provide an `ecosystem.config.js` (PM2 config) that:
- Runs the compiled `dist/index.js` as a single instance (fork mode, not cluster —
  cluster mode multiplies memory usage, avoid it on 768MB)
- Sets `node_args: '--max-old-space-size=256'` (tune after measuring real usage)
- Enables `max_memory_restart` (e.g. `300M`) as a safety net so PM2 restarts the
  process instead of the OOM killer taking down the whole VPS
- Configures log rotation (`pm2 install pm2-logrotate` — document this in the README,
  don't try to automate the install)
Also provide a minimal `Dockerfile` for local development only (not referenced by any
production deployment step), so contributors can optionally containerize locally if
they prefer, without that choice leaking into the VPS deployment path.

## Deliverable for this setup step
1. Scaffold the folder structure above with placeholder files and TODOs
2. Working grammY bot that connects, responds to /start, and loads i18n + Redis
   (connecting to the VPS's native Redis, not a containerized one)
3. `ecosystem.config.js` (PM2) + `.env.example` + a dev-only `Dockerfile`
4. A README documenting: local dev run, PM2 production run (`pm2 start
   ecosystem.config.js`, `pm2 save`, `pm2 startup`), how to add a new command, and a
   short note on the 768MB memory budget and swap-file recommendation
Do not implement moderation logic yet — that comes in the next phase per the roadmap.