/**
 * utils/logger.ts
 *
 * Shared pino logger instance.
 *
 * Production: structured JSON to stdout, captured and rotated by PM2 via
 * pm2-logrotate. Never write to files directly — let PM2 handle that.
 *
 * Development: pino-pretty transport for human-readable colourised output.
 * pino-pretty is an optional dev dependency — if missing, falls back to JSON.
 */

import pino from "pino";
import { env } from "../config/env.js";

function buildLogger(): pino.Logger {
  const base = {
    level: env.LOG_LEVEL,
    base: { service: "alphapack-bot" },
  };

  if (env.NODE_ENV === "development") {
    // pino-pretty is not listed as a prod dependency to keep the production
    // bundle lean. We use a try/require to gracefully degrade.
    try {
      return pino({
        ...base,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname,service",
            messageFormat: "{msg}",
          },
        },
      });
    } catch {
      // pino-pretty not available — fall through to plain JSON
    }
  }

  return pino(base);
}

export const logger = buildLogger();
