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
| `NODE_ENV` | Application environment (`development` or `production`). | `production` |
| `LOG_LEVEL` | Pino logger output verbosity (`debug`, `info`, `warn`, `error`). | `info` |
| `BOT_CUSTOM_NAME` | The bot name used in welcome, goodbye, rules, and guide templates. If omitted, falls back to the bot's first name on Telegram. | `Alpha Pack` |

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
*   Allows toggling settings (Welcome, Goodbye, Captcha, Anti-Flood, Admin Relay, Username Notify, etc.) and updating templates (Rules, Guide, Welcome/Goodbye text) in real-time.
*   Uses a robust Redis-backed handoff state for multi-step editing conversations to prevent grammY replay engine crashes.

---

## 🚧 Under Development Features

The settings control panel contains placeholders for the following features that are currently scoped as under development. Clicking these buttons will trigger a popup notifying the admin:

*   **🔤 Alphabets**
*   **🖼️ Media**
*   **💂🏼 Sentry**

---

## 🛠️ Commands List

### Admin Commands (Group Only)
*   `!warn` / `/warn` [reply to message] — Warn a user
*   `!mute` / `/mute` [reply to message] — Mute a user
*   `!tban` / `/tban` [duration] [reply to message] — Temp-ban a user (e.g. `!tban 1d`)
*   `!ban` / `/ban` [reply to message] — Ban a user
*   `!unban` / `/unban` [username or ID] — Unban a user
*   `!unmute` / `/unmute` [username or ID] — Unmute a user
*   `!settings` / `/settings` — Trigger settings configuration panel (redirects to DM)

### Public Commands
*   `!ping` / `/ping` — Smoke-test bot liveness
*   `!rules` / `/rules` — Display the group's rules text (with link previews enabled)
*   `!guide` / `/guide` — Display the group's guide text (with link previews enabled)

---

## 🚢 Production Deployment (VPS)

On your host machine, install PM2 globally:
```bash
npm install -g pm2
```

1.  Build the TypeScript project:
    ```bash
    npm run build
    ```
2.  Start the daemon using the bundled ecosystem config:
    ```bash
    pm2 start ecosystem.config.js
    pm2 save
    pm2 startup
```

### VPS Swap File (Recommended for 768 MB RAM VPS)
If you run out of memory during `npm install` or `tsc` compilation on a small VPS, configure a swap partition:
```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
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
│   ├── group-settings.ts      # Preloads settings from Redis/defaults into ctx
│   └── username-tracker.ts    # Maps Usernames to IDs on messages to resolve targets
├── types/                     # TypeScript types (context, group settings models)
├── utils/                     # Utility libraries (logger, placeholder formatting)
└── features/                  # Business logic submodules
    ├── moderation/            # Warn, Mute, Ban handlers
    ├── anti-spam/             # Rate limiters & flood guards
    ├── welcome/               # Member join/leave hooks & Captcha mechanics
    ├── mentions/              # Admin relays & User notifications
    ├── settings/              # Settings menu inline-keyboard and conversation flows
    └── scheduler/             # Cron daemon for processing scheduled unban/unmutes
```
