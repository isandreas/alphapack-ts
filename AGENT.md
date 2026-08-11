# AI Developer Guidelines for AlphaPack Bot

This document outlines the architecture, constraints, and development guidelines for AI agents assisting with the AlphaPack Telegram group management bot.

---

## ⚡ Critical Project Context

*   **Self-Hosted VPS Target:** The bot is optimized to run on low-resource, self-hosted VPS machines (e.g., 768 MB - 1 GB RAM).
*   **Native Redis:** Uses the host machine's native `redis-server` (connected via `REDIS_URL`). Do not suggest Docker containers for Redis, as native Redis minimizes memory overhead.
*   **Execution Limits:** Production runs via PM2 in single-instance `fork` mode with a memory cap: `--max-old-space-size=256` and `max_memory_restart: '300M'`.
*   **Long Polling Only:** The application operates strictly via long polling (grammY runner). There are no webhooks, Express servers, or HTTP listeners.
*   **Veto Auto-Commits:** Under no circumstances should the agent perform git commits automatically. Let the user review the changes and commit manually.

---

## 🛠️ Architecture & Code Conventions

### 1. Command Prefix Normalization
*   **Prefixes:** All commands must support both `/cmd` and `!cmd` prefixes.
*   **How it works:** Do not register duplicate handlers. The bot uses `commandParserMiddleware` (`src/middlewares/command-parser.ts`) to rewrite `!` prefixes into `/` prefixes before the router processes them. 
*   **Usage:** Simply register your command using standard grammY hooks: `bot.command("mycmd", handler)`.

### 2. Group Settings & Redis
*   **Defaults:** Base configurations are stored in `src/config/defaults.yaml`.
*   **State Sync:** When updating a setting in Redis, always reload the settings back into the context memory (`ctx.groupSettings`) immediately to keep the interactive UI menu aligned with the source of truth and prevent "outdated menu" errors. Use the helper `updateSettingAndReload` in `src/features/settings/settings-menu.ts`.

### 3. grammY Conversations v2 & Replay Engine
*   **The Replay Hazard:** grammY conversations v2 replays the conversation function on every incoming message. During replay runs, middleware is not re-applied, and `ctx.session` is `undefined`.
*   **Accessing External State:** Never read `ctx.session` directly within a conversation block. Instead:
    *   Store transient handoff state (such as the target `chatId` or `settingKey` being edited) in Redis under a short-lived key (e.g., using `settingsEditKey(userId)`).
    *   Read the state inside the conversation block using `conversation.external(() => ...)` to fetch it from Redis.
*   **Message Context:** Always use the awaited context (e.g., `nextCtx = await conversation.waitFor(...)`) for replying to users inside conversation loops, rather than the initial entry context `ctx`.

### 4. Admin Decorators & Permission Checks
*   Use `requireAdmin()` middleware to gate commands.
*   Use `isGroupAdmin(ctx, chatId, userId)` for non-decorator checks. Group admin lists are cached in Redis for 5 minutes (TTL).

---

## ⚙️ Development Workflow

*   **Type Safety:** Always run typechecking and build validation before presenting solutions:
    ```bash
    npm run typecheck && npm run build
    ```
*   **Hot-Reloading:** During local development, the bot runs using `tsx watch` via `npm run dev`.
*   **Translations:** User-facing strings must be localized using Project Fluent files under `src/i18n/en/translation.ftl` and `src/i18n/id/translation.ftl`. Do not hardcode English/Indonesian strings in the feature logic.
*   **No Placeholders:** When adding or editing code, do not write placeholders or stub functions. Ensure all logic is fully implemented.
