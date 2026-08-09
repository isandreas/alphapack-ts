/**
 * db/redis.ts
 *
 * Single Redis client singleton connecting to the VPS's native redis-server.
 *
 * IMPORTANT: This connects to the HOST's existing Redis (REDIS_URL env var),
 * NOT a containerised instance. No Docker, no docker-compose.
 *
 * Exports:
 *   getRedisClient()  — returns the singleton (creates it on first call)
 *   connect()         — eagerly connects + logs success/failure (called in index.ts)
 *   healthcheck()     — sends PING, returns true/false (used for startup check)
 *   closeRedisClient() — graceful disconnect (called in shutdown handler)
 */

import Redis from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

let _client: Redis | null = null;

// ── Singleton ──────────────────────────────────────────────────────────────────

/**
 * Returns the shared ioredis client singleton.
 * The TCP connection is initiated on first call (lazyConnect: false ensures
 * the socket opens immediately, but the Promise-level connect() below adds
 * explicit startup verification).
 */
export function getRedisClient(): Redis {
  if (_client) return _client;

  _client = new Redis(env.REDIS_URL, {
    // Exponential back-off reconnect, capped at 10 s.
    // Keeps retrying indefinitely — PM2 max_memory_restart is the circuit breaker.
    retryStrategy: (times: number) => Math.min(times * 200, 10_000),

    commandTimeout: 5_000,
    lazyConnect: true,        // We control when to connect via connect() below
    keepAlive: 30_000,        // TCP keepalive to prevent silent NAT drops on the VPS
    enableOfflineQueue: true, // Queue commands while reconnecting (short outages)
    maxRetriesPerRequest: 3,
  });

  _client.on("connect", () => {
    logger.info({ event: "redis_connect", url: env.REDIS_URL }, "Redis connected");
  });

  _client.on("ready", () => {
    logger.debug({ event: "redis_ready" }, "Redis ready to accept commands");
  });

  _client.on("error", (err: Error) => {
    // Log but do NOT crash — ioredis will reconnect. The bot degrades gracefully
    // (group-settings falls back to defaults, session writes are queued).
    logger.error({ event: "redis_error", err }, "Redis error");
  });

  _client.on("close", () => {
    logger.warn({ event: "redis_close" }, "Redis connection closed — reconnecting");
  });

  _client.on("reconnecting", (ms: number) => {
    logger.info({ event: "redis_reconnecting", delay_ms: ms }, "Redis reconnecting");
  });

  return _client;
}

// ── Startup connect ────────────────────────────────────────────────────────────

/**
 * Eagerly connects to Redis and verifies the connection with a PING.
 *
 * Called once in index.ts before starting the bot runner.
 * Exits the process with a clear error if Redis is unreachable — the bot
 * cannot function without session storage.
 */
export async function connect(): Promise<void> {
  const client = getRedisClient();

  try {
    await client.connect();
    logger.info(
      { event: "redis_connect_success", url: env.REDIS_URL },
      "Redis connected successfully ✓",
    );
  } catch (err: unknown) {
    logger.fatal(
      { event: "redis_connect_failed", url: env.REDIS_URL, err },
      `Cannot connect to Redis at ${env.REDIS_URL}.\n` +
        "  → Is redis-server running on the host?  Check: systemctl status redis\n" +
        "  → Is REDIS_URL in .env pointing to the right host/port?\n" +
        "Aborting.",
    );
    process.exit(1);
  }
}

// ── Health check ───────────────────────────────────────────────────────────────

/**
 * Sends a PING command and waits for PONG.
 * Returns true if Redis is healthy, false on any error.
 *
 * Useful for periodic liveness checks or health endpoints in future phases.
 */
export async function healthcheck(): Promise<boolean> {
  try {
    const result = await getRedisClient().ping();
    return result === "PONG";
  } catch {
    return false;
  }
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────

/**
 * Cleanly closes the Redis connection.
 * Call this inside SIGTERM/SIGINT shutdown handlers.
 */
export async function closeRedisClient(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = null;
    logger.info({ event: "redis_disconnected" }, "Redis disconnected gracefully");
  }
}
