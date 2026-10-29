/**
 * In-memory Redis mock for unit and integration tests.
 *
 * Patches the singleton returned by `getRedisClient()` so all feature modules,
 * sessions, rate limiters, and conversations operate deterministically in memory
 * without requiring a live Redis server.
 */

import { getRedisClient } from "../../src/db/redis.js";

export class InMemoryRedisStore {
  private kv = new Map<string, string>();
  private ttls = new Map<string, number>();
  private hashes = new Map<string, Map<string, string>>();
  private sets = new Map<string, Set<string>>();
  private zsets = new Map<string, Map<string, number>>();

  clear(): void {
    this.kv.clear();
    this.ttls.clear();
    this.hashes.clear();
    this.sets.clear();
    this.zsets.clear();
  }

  install(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getRedisClient() as any;

    client.status = "ready";
    client.ping = async () => "PONG";

    client.get = async (key: string): Promise<string | null> => {
      return this.kv.get(key) ?? null;
    };

    client.set = async (
      key: string,
      value: string | number,
      ...args: Array<string | number>
    ): Promise<"OK" | null> => {
      const upperArgs = args.map((a) => String(a).toUpperCase());
      if (upperArgs.includes("NX") && this.kv.has(key)) {
        return null;
      }
      this.kv.set(key, String(value));
      const exIdx = upperArgs.indexOf("EX");
      if (exIdx !== -1 && args[exIdx + 1] !== undefined) {
        this.ttls.set(key, Number(args[exIdx + 1]));
      }
      return "OK";
    };

    client.setex = async (
      key: string,
      seconds: number,
      value: string,
    ): Promise<"OK"> => {
      this.kv.set(key, String(value));
      this.ttls.set(key, seconds);
      return "OK";
    };

    client.incr = async (key: string): Promise<number> => {
      const current = parseInt(this.kv.get(key) ?? "0", 10);
      const next = (Number.isNaN(current) ? 0 : current) + 1;
      this.kv.set(key, String(next));
      return next;
    };

    client.decr = async (key: string): Promise<number> => {
      const current = parseInt(this.kv.get(key) ?? "0", 10);
      const next = (Number.isNaN(current) ? 0 : current) - 1;
      this.kv.set(key, String(next));
      return next;
    };

    client.del = async (...keys: string[]): Promise<number> => {
      let count = 0;
      for (const k of keys) {
        if (
          this.kv.delete(k) ||
          this.hashes.delete(k) ||
          this.sets.delete(k) ||
          this.zsets.delete(k)
        ) {
          count++;
        }
        this.ttls.delete(k);
      }
      return count;
    };

    client.ttl = async (key: string): Promise<number> => {
      if (!this.kv.has(key)) return -2;
      return this.ttls.get(key) ?? -1;
    };

    client.expire = async (key: string, seconds: number): Promise<number> => {
      this.ttls.set(key, seconds);
      return 1;
    };

    client.hset = async (
      key: string,
      fieldOrObj: string | Record<string, string>,
      value?: string,
    ): Promise<number> => {
      if (!this.hashes.has(key)) {
        this.hashes.set(key, new Map());
      }
      const h = this.hashes.get(key)!;
      if (typeof fieldOrObj === "string") {
        h.set(fieldOrObj, String(value ?? ""));
        return 1;
      }
      let count = 0;
      for (const [f, v] of Object.entries(fieldOrObj)) {
        h.set(f, String(v));
        count++;
      }
      return count;
    };

    client.hget = async (key: string, field: string): Promise<string | null> => {
      return this.hashes.get(key)?.get(field) ?? null;
    };

    client.hgetall = async (key: string): Promise<Record<string, string>> => {
      const h = this.hashes.get(key);
      if (!h) return {};
      return Object.fromEntries(h.entries());
    };

    client.hdel = async (key: string, ...fields: string[]): Promise<number> => {
      const h = this.hashes.get(key);
      if (!h) return 0;
      let removed = 0;
      for (const f of fields) {
        if (h.delete(f)) removed++;
      }
      return removed;
    };

    client.sadd = async (key: string, ...members: string[]): Promise<number> => {
      if (!this.sets.has(key)) {
        this.sets.set(key, new Set());
      }
      const s = this.sets.get(key)!;
      let added = 0;
      for (const m of members) {
        if (!s.has(String(m))) {
          s.add(String(m));
          added++;
        }
      }
      return added;
    };

    client.sismember = async (key: string, member: string): Promise<number> => {
      return this.sets.get(key)?.has(String(member)) ? 1 : 0;
    };

    client.zadd = async (
      key: string,
      score: number,
      member: string,
    ): Promise<number> => {
      if (!this.zsets.has(key)) {
        this.zsets.set(key, new Map());
      }
      const z = this.zsets.get(key)!;
      z.set(String(member), Number(score));
      return 1;
    };

    client.zremrangebyscore = async (
      key: string,
      min: number | string,
      max: number | string,
    ): Promise<number> => {
      const z = this.zsets.get(key);
      if (!z) return 0;
      const minVal = min === "-inf" ? -Infinity : Number(min);
      const maxVal = max === "+inf" ? Infinity : Number(max);
      let removed = 0;
      for (const [member, score] of z.entries()) {
        if (score >= minVal && score <= maxVal) {
          z.delete(member);
          removed++;
        }
      }
      return removed;
    };

    client.zcard = async (key: string): Promise<number> => {
      return this.zsets.get(key)?.size ?? 0;
    };

    client.zrangebyscore = async (
      key: string,
      min: number | string,
      max: number | string,
    ): Promise<string[]> => {
      const z = this.zsets.get(key);
      if (!z) return [];
      const minVal = min === "-inf" ? -Infinity : Number(min);
      const maxVal = max === "+inf" ? Infinity : Number(max);
      return Array.from(z.entries())
        .filter(([, score]) => score >= minVal && score <= maxVal)
        .sort((a, b) => a[1] - b[1])
        .map(([member]) => member);
    };

    client.zrem = async (key: string, ...members: string[]): Promise<number> => {
      const z = this.zsets.get(key);
      if (!z) return 0;
      let removed = 0;
      for (const m of members) {
        if (z.delete(String(m))) removed++;
      }
      return removed;
    };

    client.pipeline = () => {
      const ops: Array<() => Promise<unknown>> = [];
      const pipe = {
        hset: (key: string, field: string, val: string) => {
          ops.push(() => client.hset(key, field, val));
          return pipe;
        },
        expire: (key: string, seconds: number) => {
          ops.push(() => client.expire(key, seconds));
          return pipe;
        },
        exec: async () => {
          const results = [];
          for (const op of ops) {
            results.push([null, await op()]);
          }
          return results;
        },
      };
      return pipe;
    };
  }
}

