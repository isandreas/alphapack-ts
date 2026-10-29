# AlphaPack Bot

Production-grade Telegram group management bot built with TypeScript, grammY, and Redis.

Optimized specifically for **self-hosting on small VPS systems** with highly constrained resources (e.g. 768 MB or 1 GB RAM).

---

## ⚡ Self-Hosted VPS Optimizations

AlphaPack is optimized to minimize memory footprint and run efficiently in low-resource environments:

*   **Native Redis Mapping:** The bot connects to the host machine's native `redis-server` (via `REDIS_URL` in `.env`). Running a native Redis service avoids the overhead of Docker containers, saving ~80–150 MB of idle memory.
*   **PM2 Fork Mode:** Configured for single-instance PM2 `fork` mode rather than `cluster` mode to prevent multiple Node.js worker heaps from scaling up memory consumption.
*   **Memory Restraints:** Launched with node arguments `--max-old-space-size=256` to strictly limit the Node.js V8 heap, with a PM2 safety limit `max_memory_restart: '300M'` to handle unexpected leaks gracefully.
*   **Long Polling Only:** No webhooks, webhook certificate managers, or additional HTTP web servers are configured.

---

## ⚙️ Configuration & Environment Variables

All settings are configured using a `.env` file at the root of the project. Copy `.env.example` to get started:

```bash
cp .env.example .env
```

### Available Environment Keys

| Variable | Description | Default |
|---|---|---|
| `BOT_TOKEN` | **Required.** The Telegram Bot token received from [@BotFather](https://t.me/BotFather) | *None* |
| `REDIS_URL` | Redis server connection string. | `redis://127.0.0.1:6379` |
| `DEFAULT_LOCALE` | Fallback language code (`id` or `en`). | `id` |
| `NODE_ENV` | Application environment (`development`, `production`, or `test`). | `development` |
| `LOG_LEVEL` | Pino logger output verbosity (`trace`, `debug`, `info`, `warn`, `error`, `fatal`). | `info` |
| `BOT_CUSTOM_NAME` | The bot name used in welcome, goodbye, rules, and guide templates. If omitted, falls back to the bot's first name on Telegram. | `Alpha Pack` |
| `OPS_CHANNEL_ID` | Optional global Telegram channel ID for bot-operator crash/error alerts and >80% memory warnings. If unset, alerting is skipped silently. | `null` |
| `OWNER_ID` | Optional single numeric Telegram user ID allowed to run `/health` in DM. If unset, `/health` refuses everyone unconditionally. | `null` |
| `AUDIT_LOG_RETENTION_DAYS` | Number of days to retain daily flat-file audit logs under `logs/audit/YYYY-MM-DD.jsonl`. | `30` |

---

## 🚀 Supported Features

### 1. Unified Command Parser
All commands support both `/cmd` and `!cmd` syntax out-of-the-box (e.g. `/ping` or `!ping`, `/ban` or `!ban`). The `commandParserMiddleware` handles this automatically at the edge.

### 2. Auto-Moderation & Enforcement
*   **Warnings (`/warn` / `!warn`):** Issues warnings to bad actors. Warns persist in Redis and trigger automatic ban escalation when reaching the warning threshold.
*   **Mutes (`/mute` / `!mute`):** Temporarily or permanently restricts users from sending messages.
*   **Bans (`/ban` / `!ban`):** Permanent ban from the group.
*   **Temp-Bans (`/tban` / `!tban`):** Restricts a user for a duration. Unban is handled automatically by a Redis sorted-set scheduler daemon.
*   **Manual Unbans/Unmutes (`/unban`, `/unmute`):** Restores member permissions manually.

### 3. Anti-Flood & Captcha Gate
*   **Anti-Flood:** Automatically detects rapid message spam (sliding window threshold). Punishes offenders with a timed mute.
*   **Captcha Gate:** New members are restricted immediately upon joining. They must solve an inline button captcha ("I'm not a robot") within a configurable timeout or they are automatically kicked.

### 4. Welcome & Goodbye Messages
*   Supports HTML templates with placeholders: `{user_displayname}`, `{user_id}`, `{user_username}`, `{group_name}`, and `{bot_name}`. Link previews are automatically enabled.

### 5. Mentions & Reports
*   **Admin Relay:** When a user tags `@admin` in a group, the message is relayed to group admins in their DMs. Admins can claim and resolve reports directly from DMs.
*   **Username Notifications:** Relays mentions of specific user handles to target users via DM if they've registered.

### 6. Interactive Settings Control Panel (`/settings`)
*   Accessible only via Private Messages (DM) with the bot. Triggering it in a group sends a secure deep-link button to DM.
*   Allows toggling settings (Moderation, Commands, Welcome, Goodbye, Captcha, Anti-Flood, Admin Relay, Username Notify, etc.) and updating templates (Rules, Guide, Welcome/Goodbye text) in real-time.
*   Uses a robust Redis-backed handoff state for multi-step editing conversations to prevent grammY replay engine crashes.

### 7. Auto-Moderation Filters
Configured exclusively through `/settings` → **Alphabets** and **Media** submenus. No standalone commands — all 11 toggles are menu-only.

#### 🔤 Alphabet / Script Filter
Blocks and kicks users who post messages (or captions) containing characters from restricted Unicode scripts. Each script is an **independent toggle** — there is no global enable switch.

| Script | Toggle key | Unicode range(s) |
|---|---|---|
| Cyrillic | `cyrillic` | U+0400–U+04FF |
| Arabic | `arabic` | U+0600–U+06FF + U+0750–U+077F (Supplement) |
| CJK (Han / Hiragana / Katakana / Hangul) | `cjk` | U+4E00–U+9FFF, U+3040–U+30FF, U+AC00–U+D7A3 |
| Thai | `thai` | U+0E00–U+0E7F |
| Hebrew | `hebrew` | U+0590–U+05FF |
| Devanagari | `devanagari` | U+0900–U+097F |

- **Any single character** from a restricted script triggers a delete + kick (no threshold).
- Scans both `message.text` **and** `message.caption` (photos/videos with captions are also checked).
- Admins and bots are fully exempt.
- All toggles default to `🔴 OFF` (no restriction).

#### 🖼️ Media-Type Filter
Blocks and kicks users who post restricted media types. Each type is an **independent toggle**.

| Media type | What it matches |
|---|---|
| Photo | `message.photo` |
| Video | `message.video` |
| Sticker | `message.sticker` (static, animated, and video stickers — one toggle) |
| GIF | `message.animation` (Telegram represents GIFs as animations) |
| Link | `url` or `text_link` entities in `message.entities` or `message.caption_entities` |

- If a single message matches multiple restricted categories (e.g. a photo with a URL in its caption), the user is punished **exactly once**.
- Admins and bots are fully exempt.
- All toggles default to `🔴 OFF` (no restriction).

#### Punishment (shared by both filters)
1. **Delete** the offending message.
2. **Kick** the sender (ban + immediate unban — the user can rejoin via invite link).
3. Post a **group notice** in the group's configured language (`/settings` → Lang).
4. Post a **log card** (`#alphabetkick` or `#mediakick`) to the audit log channel — no "Go to message" link since the source message is deleted.

### 8. Operational Monitoring, Alerting & Local Audit Trail (Phase 7)
*   **`/health` Command (Owner-Only DM):** Reports process uptime, RSS & V8 heap usage against the 256 MB cap, live Redis `PING`, Node.js version, environment, and last scheduler sweep time (60s per-user cooldown).
*   **Ops Channel Alerting (`OPS_CHANNEL_ID`):** Posts concise crash/error summaries (first 4 stack lines, deduplicated per error for 5 minutes) and high-memory warnings (RSS > 80% of 256 MB cap, 1-hour cooldown) while logging full details to pino/PM2.
*   **Flat-File JSONL Audit Logs:** Every moderation action card and `/settings` menu change (`#SETTINGSCHANGE`) is appended in real time to `logs/audit/{YYYY-MM-DD}.jsonl` on disk (consuming zero Redis RAM) and automatically pruned after `AUDIT_LOG_RETENTION_DAYS` (default 30 days).

### 9. Group Utility Commands & Legacy Transition (`!star`, `!user`, `!adminlist`)
*   **`!`-Only Prefix Guard:** `!star`, `!user`, and `!adminlist` respond strictly to the `!` prefix (ignoring `/star`, `/user`, `/adminlist`) and are gated under `/settings` → **⌨️ Commands**. When disabled in `/settings`, they silently do not reply in the group.
*   **Stars (`!star`):** Admins can award or deduct stars (`!star +[n]` or `!star -[n]`) via reply or explicit `@username`/`user_id` (floored at `0`, stored in `alphapack:<chatId>:stars` hash).
*   **User Info (`!user`):** Any member can view user details (Display Name, User ID, Username, Warns `X/threshold`, and Stars) for themselves, a replied message, or an explicit `@username`/`user_id`.
*   **Admin List (`!adminlist`):** Any member can list human group administrators with the **Creator** displayed first followed by **Admins** using plain display names (no ping).
*   **Legacy Redis Dump Import (`npm run import-dump`):** CLI script (`src/scripts/import-dump.ts`) to migrate legacy bot Redis dumps (`chat:<chat_id>:warns` → `alphapack:<chatId>:warns`, `chat:<chat_id>:winevent` → `alphapack:<chatId>:stars`, and `cache:chat:<chat_id>:admins` → `alphapack:<chatId>:admin_cache`):
    ```bash
    npm run import-dump -- scripts/legacy-dump.example.json
    ```

---

## 🛠️ Commands List

### Owner Commands (DM Only)
*   `!health` / `/health` — Diagnostic status report (restricted strictly to `OWNER_ID`, 60s cooldown)

### Admin Commands
*   `!warn` / `/warn` [reply or user] [reason] — Warn a user (group only)
*   `!mute` / `/mute` [reply or user] [duration] [reason] — Mute a user (group only)
*   `!tban` / `/tban` [reply or user] <duration> [reason] — Temp-ban a user, e.g. `!tban 1d` (group only)
*   `!ban` / `/ban` [reply or user] [reason] — Permanently ban a user (group only)
*   `!unban` / `/unban` [reply or user] — Unban a user and reset warning count (group only)
*   `!unmute` / `/unmute` [reply or user] — Unmute a user (group only)
*   `!star` [reply or user] `+[n]`|`-[n]` — Add or subtract stars for a user (group only, `!` prefix only)
*   `!settings` / `/settings` — Open interactive settings control panel (group redirects to DM; 4s cooldown)
*   `!setlogchannel` / `/setlogchannel` — Configure the group's moderation audit log channel (DM only)

### Public Commands
*   `!ping` / `/ping` — Smoke-test bot liveness
*   `!rules` / `/rules` — Display the group's rules text (group only, 60s chat-wide cooldown)
*   `!guide` / `/guide` — Display the group's guide text (group only, 60s chat-wide cooldown)
*   `!user` [reply or user] — Display user info: Name, User ID, Username, Warns, and Stars (group only, `!` prefix only)
*   `!adminlist` — Display group Creator and Admins without pinging (group only, `!` prefix only)

---

## 🚢 Production Deployment & Operations Runbook (VPS)

### 1. Starting in Production with PM2
Install PM2 and `pm2-logrotate` globally on the VPS:
```bash
npm install -g pm2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

Compile TypeScript + copy runtime assets (`src/i18n` and `src/config/defaults.yaml`) into `dist/`, then start the daemon using [ecosystem.config.js](file:///Users/isandreas/Documents/works/personal/alphapack-ts/ecosystem.config.js):
```bash
npm run build
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```
> **Important:** After running `pm2 startup`, copy and run the exact `sudo env PATH=... pm2 startup systemd -u <user> --hp <home>` command that PM2 prints to the terminal, then run `pm2 save` once more so the process list is restored automatically across VPS reboots.

### 2. Redis Backup Strategy (RDB / AOF)
AlphaPack connects to the host's native `redis-server` (`127.0.0.1:6379`).
By default on this host, Redis is configured with **RDB snapshotting enabled** and **AOF disabled** (`redis-cli CONFIG GET save appendonly`):
*   `save`: `"3600 1 300 100 60 10000"` — Redis automatically writes an RDB snapshot (`dump.rdb`) every 60 minutes if at least 1 key changed, every 5 minutes if ≥100 keys changed, or every 60 seconds if ≥10,000 keys changed.
*   `appendonly`: `"no"` — Append-Only File logging is disabled, keeping disk I/O and memory overhead minimal on the 768 MB VPS.

**Manual On-Demand Backup (before risky changes or upgrades):**
Trigger an asynchronous background RDB snapshot and verify its completion timestamp before deploying:
```bash
redis-cli BGSAVE
redis-cli LASTSAVE
```

### 3. Memory Monitoring & Interpreting the 768 MB Budget
Use the following commands to monitor process and host memory:
```bash
pm2 monit
pm2 status
free -m
```
**How to interpret the numbers against the 768 MB VPS budget:**
*   **Node.js V8 Heap Cap (`256 MB`):** Set via `node_args: "--max-old-space-size=256"` in `ecosystem.config.js`. Normal steady-state RSS for `alphapack-bot` is **~65–110 MB**.
*   **Ops Alert Threshold (`204.8 MB` RSS / 80% of 256 MB):** If process RSS exceeds `204.8 MB`, the built-in memory monitor logs a `memory_warning` via pino and posts an alert to `OPS_CHANNEL_ID` (rate-limited to once per hour).
*   **PM2 Hard Restart Ceiling (`300 MB` RSS):** Configured via `max_memory_restart: "300M"`. If RSS reaches 300 MB, PM2 gracefully restarts the process before the Linux OOM killer can impact `redis-server` or the OS.
*   **Host RAM (`free -m`):** look at the **`available`** column (not `free`, since Linux caches disk pages in `buff/cache`). On a 768 MB VPS running OS + `redis-server` (~15–30 MB) + `alphapack-bot` (~80–110 MB), `available` should stay comfortably above **350–450 MB**.

### 4. Restart Procedure (`pm2 restart` vs `pm2 reload`)
After pulling new code and running `npm run build`:
```bash
npm run build
pm2 restart alphapack-bot
```
*   **When to prefer `pm2 restart alphapack-bot` (Recommended):** Because AlphaPack runs in single-instance `fork` mode using Telegram **long polling (`getUpdates`)**, only one process may poll the Bot token at a time. `pm2 restart` sends `SIGINT`, waits for the old process to stop its grammY runner and close Redis cleanly, and then starts the new process — preventing `409 Conflict: terminated by other getUpdates request` errors.
*   **When `pm2 reload alphapack-bot` applies:** `pm2 reload` is designed for stateless HTTP/webhook servers in `cluster` mode to achieve zero-downtime socket handoff. Because this bot uses long polling in `fork` mode (no HTTP server), always use `pm2 restart alphapack-bot`.

### 5. Reading Audit Logs & Checking `OPS_CHANNEL_ID` Alerts
*   **Local Flat-File Audit Logs (`logs/audit/YYYY-MM-DD.jsonl`):**
    Every call to `postActionCard` (moderation actions + `/settings` menu `#SETTINGSCHANGE` events) appends one JSON line (`{"timestamp","chatId","card"}`) to today's file on disk. Files older than `AUDIT_LOG_RETENTION_DAYS` (default 30) are pruned daily based on the filename date.
    ```bash
    # View today's raw audit trail
    cat logs/audit/$(date -u +%F).jsonl

    # Filter for a specific group chatId or action tag
    grep "#SETTINGSCHANGE" logs/audit/*.jsonl
    grep -- "-1001234567890" logs/audit/*.jsonl
    ```
*   **Checking `OPS_CHANNEL_ID` Alerts:**
    *   Set `OPS_CHANNEL_ID=-100xxxxxxxxxx` in `.env` (make sure the bot is an administrator in that channel with **Post Messages** permission).
    *   Unhandled handler errors (`bot.catch`) and process-level exceptions (`unhandledRejection` / `uncaughtException`) post a concise 4-line stack excerpt to `OPS_CHANNEL_ID` (deduplicated per distinct error for **5 minutes**) while full stack traces are always written to `pm2 logs alphapack-bot`.

### 6. Troubleshooting Checklist ("If the Bot Seems Stuck")
If the bot stops responding to commands or scheduled unbans/unmutes appear delayed, run through these 4 checks in order:

1.  **Check PM2 process status & recent logs:**
    ```bash
    pm2 status
    pm2 logs alphapack-bot --lines 100
    ```
    Look for `409 Conflict` (another instance polling the same token), `redis_error`, or repeated restart loops (`↺` column in `pm2 status`).
2.  **Run `/health` via DM (as `OWNER_ID`):**
    Send `/health` to the bot in a private message. Verify:
    *   `Redis: ✅ PONG`
    *   `RSS` and `Heap used` are below `80%` (`204.8 MB`)
    *   `Scheduler last run` is `< 1m ago` (the scheduler sweeps every 30 seconds; if this isseveral minutes old, the timer loop is stalled).
3.  **Check native Redis connectivity & status:**
    ```bash
    redis-cli PING
    sudo systemctl status redis
    ```
    If `redis-cli PING` does not return `PONG`, restart Redis (`sudo systemctl restart redis`) and then `pm2 restart alphapack-bot`.
4.  **Check disk space for PM2 & JSONL audit logs:**
    ```bash
    df -h
    du -sh logs/ logs/audit/
    ```
    If disk usage is at 100%, `appendAuditLog` and PM2 logs will fail to write. Flush old PM2 logs with `pm2 flush` and verify `AUDIT_LOG_RETENTION_DAYS` is set appropriately.

### 7. VPS Swap File (Recommended for 768 MB RAM VPS)
If you run out of memory during `npm install` or `tsc` compilation on a small VPS, configure a 1 GB swap file:
```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 🧪 Running Tests

Unit and integration tests use **Vitest** and grammY's API transformer (`bot.api.config.use`) with an in-memory Redis store — no live Telegram token or external network calls are made during tests:

```bash
npm test
npm run typecheck && npm run build
```

---

## 📂 Project Structure

```
src/
├── bot.ts                     # Bot bootstrap, middleware pipeline, and main routing
├── index.ts                   # Entrypoint (validates env, connects to Redis, starts runner)
├── config/
│   ├── env.ts                 # Zod-validated environment config
│   └── defaults.yaml          # Fallback default values for group settings
├── db/
│   ├── redis.ts               # Redis connection manager and status checks
│   └── keys.ts                # Central index for all Redis key naming namespaces
├── i18n/                      # Fluent (.ftl) translation files (en, id)
├── middlewares/
│   ├── command-parser.ts      # Transforms !cmd into /cmd
│   ├── admin-guard.ts         # Gated access decorator for admin-only commands
│   ├── group-settings.ts      # Preloads settings from Redis/defaults + menu audit writer
│   ├── logger.ts              # Structured request logging + postActionCard helper
│   └── username-tracker.ts    # Maps Usernames to IDs on messages to resolve targets
├── types/                     # TypeScript types (context, group settings models)
├── utils/                     # Utility libraries (logger, ops-alert, audit-log, time-parser)
├── scripts/
│   └── import-dump.ts         # CLI & helper to import legacy Redis JSON dump
└── features/                  # Business logic submodules
    ├── community/             # !star, !user, and !adminlist group commands
    ├── moderation/            # Warn, Mute, Ban, alphabet/media filters
    ├── anti-spam/             # Rate limiters & flood guards
    ├── welcome/               # Member join/leave hooks & Captcha mechanics
    ├── mentions/              # Admin relays & User notifications (with pacing & 429 backoff)
    ├── ops/                   # Owner-only /health diagnostic command
    ├── settings/              # Settings menu inline-keyboard and conversation flows
    └── scheduler/             # Cron daemon for processing scheduled unban/unmutes
tests/
├── helpers/mock-redis.ts      # In-memory Redis mock for deterministic tests
├── unit/                      # Unit tests (command-parser, permissions, time-parser, warn threshold)
└── integration/               # Full bot flow tests using grammY API transformers
```
