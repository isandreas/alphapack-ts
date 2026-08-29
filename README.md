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

---

## 🚧 Under Development Features

The settings control panel contains a placeholder for the following feature that is currently scoped as under development:

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
    ├── moderation/            # Warn, Mute, Ban, alphabet/media filters
    │   ├── alphabet-filter.ts         # Unicode script filter middleware
    │   ├── media-filter.ts            # Media-type filter middleware
    │   └── restriction-punishment.ts  # Shared delete+kick punishment
    ├── anti-spam/             # Rate limiters & flood guards
    ├── welcome/               # Member join/leave hooks & Captcha mechanics
    ├── mentions/              # Admin relays & User notifications
    ├── settings/              # Settings menu inline-keyboard and conversation flows
    └── scheduler/             # Cron daemon for processing scheduled unban/unmutes
```
