# AlphaPack Bot

Production-grade Telegram group management bot — TypeScript, grammY, Redis.

---

## Phase 0 (Current)

Phase 0 is **foundation only** — the scaffolding, middleware chain, and smoke-test commands are implemented. No moderation, no anti-spam, no welcome messages, no settings menu yet. See the roadmap below for what's coming.

### What works now

| Feature | Status |
|---|---|
| Long polling (grammY runner) | ✅ |
| Redis connection with fail-fast startup | ✅ |
| `/start` DM greeting (i18n) | ✅ |
| `/ping` and `!ping` health check (proves command parser + i18n) | ✅ |
| Per-group settings loaded from Redis + YAML defaults | ✅ |
| Admin list cache (Redis, 5-min TTL) | ✅ |
| Session storage in Redis | ✅ |
| Structured JSON logging (pino → PM2) | ✅ |
| Graceful shutdown (SIGTERM/SIGINT drain) | ✅ |

---

## Running Locally

### Prerequisites

- Node.js ≥ 20
- Redis running locally (`brew services start redis` on macOS, or `systemctl start redis` on Linux)

### Setup

```bash
cp .env.example .env
# Fill in BOT_TOKEN from @BotFather
# REDIS_URL defaults to redis://127.0.0.1:6379

npm install
npm run dev       # tsx watch — hot-reload on save
```

`npm run dev` uses `tsx watch` so any file change in `src/` restarts the bot automatically. No build step needed during development.

### Verify it works

1. Open Telegram, find your bot
2. Send `/start` in a DM → should reply with the i18n greeting
3. Send `/ping` → should reply `🏓 Pong! Bot is alive and running.`
4. Send `!ping` → same reply (proves the command-parser middleware is working)
5. Check the terminal — you should see structured JSON log output

---

## How `/cmd` and `!cmd` Both Work

The `commandParserMiddleware` (`src/middlewares/command-parser.ts`) intercepts messages that start with `!` and rewrites them to `/` before grammY's router sees them.

```
User sends:    !ping
Middleware:    rewrites to → /ping
grammY router: fires bot.command("ping") handler
```

**Rules:**
- `!` must be at the very start of the message
- Must be immediately followed by a word character (letter, digit, `_`)
- `hello!` and `! ping` are NOT rewritten (prevents accidental triggers)
- Works for text messages and captions (e.g., `!warn` on a photo)

**No per-command wiring needed** — every future command automatically supports both prefixes.

---

## Redis Configuration

The bot connects to your **host machine's native `redis-server`** via `REDIS_URL` in `.env`.

```
REDIS_URL=redis://127.0.0.1:6379    # default — VPS native Redis
```

**Do NOT run a second Redis instance in Docker.** The VPS has Redis installed natively to save memory. Containerising Redis on a 768 MB VPS wastes ~80–150 MB idle.

### Startup behaviour

- If Redis is **unreachable** at startup → process exits with a clear diagnostic:
  ```
  Cannot connect to Redis at redis://127.0.0.1:6379.
  → Is redis-server running on the host? Check: systemctl status redis
  → Is REDIS_URL in .env pointing to the right host/port?
  ```
- If Redis goes down **after startup** → bot degrades gracefully:
  - Session reads/writes are queued or return empty
  - Group settings fall back to `defaults.yaml` values
  - ioredis reconnects automatically with exponential back-off

---

## No Webhook — Long Polling Only

Webhook mode is **not implemented** and not planned for Phase 0. The bot uses grammY's runner for long polling. There is no Express server, no HTTP listener, and no webhook registration code.

If webhook support is needed in a future phase, it must be explicitly scoped. Do not add HTTP server code without a deliberate architectural decision.

---

## Production Deployment (VPS)

### PM2 setup

```bash
# On the VPS, after copying files and running npm install + npm run build:
cp .env.example .env
# Fill in BOT_TOKEN and verify REDIS_URL

pm2 start ecosystem.config.js
pm2 save
pm2 startup     # auto-start on reboot
```

PM2 configuration highlights (see `ecosystem.config.js`):

| Setting | Value | Why |
|---|---|---|
| `exec_mode` | `fork` | Cluster mode multiplies memory — avoid on 768 MB VPS |
| `node_args` | `--max-old-space-size=256` | Caps Node.js heap; leaves headroom for OS + Redis |
| `max_memory_restart` | `300M` | Safety net: PM2 restarts if RSS exceeds 300 MB |
| `instances` | `1` | One process — bot is stateful via Redis, not stateless |

### VPS swap file (recommended for 768 MB)

If you hit OOM during npm install or builds:

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Project Structure

```
src/
├── bot.ts                     # Bot assembly, middleware chain, command handlers
├── index.ts                   # Entrypoint: env → redis → bot → runner
├── config/
│   ├── env.ts                 # Zod-validated env loader (fail-fast)
│   └── defaults.yaml          # Per-group default settings skeleton
├── db/
│   ├── redis.ts               # ioredis singleton, connect(), healthcheck()
│   └── keys.ts                # Central Redis key naming (all key strings live here)
├── i18n/
│   ├── en/translation.ftl     # English strings (Project Fluent format)
│   └── id/translation.ftl     # Indonesian strings
├── middlewares/
│   ├── command-parser.ts      # ! → / prefix normalisation
│   ├── admin-guard.ts         # isGroupAdmin() + requireAdmin() with Redis cache
│   ├── group-settings.ts      # ctx.groupSettings loader + getGroupSettings()
│   ├── logger.ts              # Audit logger middleware
│   └── anti-spam.ts           # Phase 0 stub (Phase 2 implementation)
├── types/
│   ├── context.ts             # BotContext flavor chain
│   └── settings.ts            # GroupSettings interface
├── utils/
│   ├── logger.ts              # Shared pino instance
│   └── permissions.ts         # isAdmin() (uncached, direct API)
└── features/                  # Phase 2+ handlers (stubs only in Phase 0)
    ├── moderation/            # warn, mute, tban, ban (Phase 2)
    ├── anti-spam/             # flood-guard, link-filter (Phase 2)
    ├── welcome/               # on-join, on-leave (Phase 3)
    ├── mentions/              # admin-mention relay (Phase 3)
    ├── settings/              # /settings menu (Phase 5)
    └── scheduler/             # tban expiry unban (Phase 2)
```

---

## Roadmap

| Phase | Scope |
|---|---|
| **0** ✅ | Foundation: env, Redis, i18n, session, command-parser, admin-guard, /start, /ping |
| **2** | Moderation: warn, mute, tban, ban, unban, flood guard, link filter |
| **3** | Welcome/goodbye messages, @admin mention relay |
| **4** | Unban scheduler (node-cron watching tban TTL keys) |
| **5** | /settings inline menu, per-group config persistence |

---

## i18n

Locale files are in `src/i18n/<locale>/` using [Project Fluent](https://projectfluent.org/) `.ftl` format.

```ftl
# src/i18n/en/translation.ftl
ping-response = 🏓 Pong! Bot is alive and running.
start-greeting =
    Hello! I'm AlphaPack 🤖
    ...
```

The active locale is determined by:
1. `ctx.session.locale` (user override — Phase 5)
2. `DEFAULT_LOCALE` env var (fallback)

Switch `DEFAULT_LOCALE=en` in `.env` to default to English.
