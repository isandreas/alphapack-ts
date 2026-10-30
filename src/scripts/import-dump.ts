/**
 * scripts/import-dump.ts
 *
 * Migrates legacy bot Redis JSON dump into AlphaPack's Redis schema.
 *
 * Supported legacy keys:
 *   1. "chat:<chat_id>:warns"    (hash) → alphapack:<chat_id>:warns (hash)
 *   2. "chat:<chat_id>:winevent" (hash) → alphapack:<chat_id>:stars (hash)
 *
 * Usage:
 *   npm run import-dump -- ./path/to/dump.json
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { getRedisClient, connect, closeRedisClient } from "../db/redis.js";
import { warnsKey, starsKey } from "../db/keys.js";
import { logger } from "../utils/logger.js";

export interface DumpEntry {
  type: string;
  ttl: number;
  value: unknown;
}

export type DumpData = Record<string, DumpEntry>;

export interface ImportSummary {
  warnsImported: number;
  starsImported: number;
  skippedKeys: number;
}

const WARNS_KEY_RE = /^chat:(-?\d+):warns$/;
const WINEVENT_KEY_RE = /^chat:(-?\d+):winevent$/;

function normalizeHashValue(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return {};

  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (v !== undefined && v !== null) {
      out[String(k)] = String(v);
    }
  }
  return out;
}

/**
 * Consumes parsed JSON dump data and writes the target key types into Redis.
 */
export async function importRedisDump(dump: DumpData): Promise<ImportSummary> {
  const redis = getRedisClient();
  const summary: ImportSummary = {
    warnsImported: 0,
    starsImported: 0,
    skippedKeys: 0,
  };

  for (const [rawKey, entry] of Object.entries(dump)) {
    if (!entry || typeof entry !== "object") {
      summary.skippedKeys++;
      continue;
    }

    // 1. "chat:<chat_id>:warns" (hash) → alphapack:<chat_id>:warns
    const warnsMatch = WARNS_KEY_RE.exec(rawKey);
    if (warnsMatch && entry.type === "hash") {
      const chatId = parseInt(warnsMatch[1]!, 10);
      const hashObj = normalizeHashValue(entry.value);
      if (hashObj && Object.keys(hashObj).length > 0) {
        const targetKey = warnsKey(chatId);
        await redis.hset(targetKey, hashObj);
        if (typeof entry.ttl === "number" && entry.ttl > 0) {
          await redis.expire(targetKey, Math.floor(entry.ttl));
        }
        summary.warnsImported++;
      } else {
        summary.skippedKeys++;
      }
      continue;
    }

    // 2. "chat:<chat_id>:winevent" (hash) → alphapack:<chat_id>:stars
    const wineventMatch = WINEVENT_KEY_RE.exec(rawKey);
    if (wineventMatch && entry.type === "hash") {
      const chatId = parseInt(wineventMatch[1]!, 10);
      const hashObj = normalizeHashValue(entry.value);
      if (hashObj && Object.keys(hashObj).length > 0) {
        const targetKey = starsKey(chatId);
        await redis.hset(targetKey, hashObj);
        if (typeof entry.ttl === "number" && entry.ttl > 0) {
          await redis.expire(targetKey, Math.floor(entry.ttl));
        }
        summary.starsImported++;
      } else {
        summary.skippedKeys++;
      }
      continue;
    }

    summary.skippedKeys++;
  }

  return summary;
}

async function runCli(): Promise<void> {
  const filePathArg = process.argv[2];
  if (!filePathArg) {
    console.error("Usage: npm run import-dump -- <path-to-dump.json>");
    process.exit(1);
  }

  const resolvedPath = resolve(process.cwd(), filePathArg);
  let dump: DumpData;

  try {
    const rawJson = readFileSync(resolvedPath, "utf-8");
    dump = JSON.parse(rawJson) as DumpData;
  } catch (err: unknown) {
    logger.fatal({ err, path: resolvedPath }, "Failed to read or parse dump JSON file");
    process.exit(1);
  }

  await connect();

  try {
    const summary = await importRedisDump(dump);
    logger.info(
      { event: "dump_import_completed", path: resolvedPath, ...summary },
      `Import completed: ${summary.warnsImported} warns hashes, ${summary.starsImported} stars hashes (${summary.skippedKeys} skipped).`,
    );
  } finally {
    await closeRedisClient();
  }
}

if (require.main === module) {
  runCli().catch((err: unknown) => {
    console.error("[import-dump] Fatal error:", err);
    process.exit(1);
  });
}

