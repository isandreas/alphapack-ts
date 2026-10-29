import { describe, it, expect, beforeEach, vi } from "vitest";
import { warnHandler } from "../../src/features/moderation/warn.js";
import { warnsKey } from "../../src/db/keys.js";
import { getRedisClient } from "../../src/db/redis.js";
import { InMemoryRedisStore } from "../helpers/mock-redis.js";
import type { BotContext } from "../../src/types/context.js";

const store = new InMemoryRedisStore();

describe("Warn threshold boundary logic (Part F)", () => {
  const CHAT_ID = -100555666777;
  const ADMIN_ID = 1001;
  const TARGET_ID = 2002;
  const BOT_ID = 9999;

  beforeEach(() => {
    store.install();
    store.clear();
  });

  function makeWarnCtx(threshold: number, banEnabled = true) {
    const replies: string[] = [];
    const banChatMember = vi.fn().mockResolvedValue(true);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 100 });

    const ctx = {
      chat: { id: CHAT_ID, type: "supergroup", title: "Test Group" },
      from: { id: ADMIN_ID, is_bot: false, first_name: "Moderator" },
      me: { id: BOT_ID, first_name: "AlphaPack", username: "alphapack_bot" },
      message: {
        message_id: 50,
        text: "/warn breaking rules",
        reply_to_message: {
          message_id: 49,
          from: {
            id: TARGET_ID,
            is_bot: false,
            first_name: "Offender",
            username: "offender",
          },
        },
      },
      groupSettings: {
        warnThreshold: threshold,
        moderation: {
          warn: { enabled: true },
          ban: { enabled: banEnabled },
          tban: { enabled: true },
          mute: { enabled: true },
        },
      },
      t: (key: string, params?: Record<string, string>) =>
        `${key}:${JSON.stringify(params ?? {})}`,
      reply: vi.fn(async (text: string) => {
        replies.push(text);
        return { message_id: 51 };
      }),
      api: {
        getChatAdministrators: vi
          .fn()
          .mockResolvedValue([{ user: { id: ADMIN_ID }, status: "administrator" }]),
        banChatMember,
        sendMessage,
      },
    } as unknown as BotContext;

    return { ctx, replies, banChatMember };
  }

  it("does NOT trigger auto-ban when count == threshold - 1, then triggers auto-ban when count == threshold", async () => {
    const threshold = 3;
    const redis = getRedisClient();

    // Pre-seed count to 1 so next warn is count == 2 (threshold - 1)
    await redis.hset(warnsKey(CHAT_ID), String(TARGET_ID), "1");

    const step1 = makeWarnCtx(threshold);
    await warnHandler(step1.ctx);

    // Boundary check: count == 2 (threshold - 1) -> warning only, NO ban
    expect(step1.banChatMember).not.toHaveBeenCalled();
    expect(await redis.hget(warnsKey(CHAT_ID), String(TARGET_ID))).toBe("2");
    expect(step1.replies[0]).toContain("reply_warned:");
    expect(step1.replies[0]).toContain('"count":"2"');

    // Next warn: count == 3 (count == threshold) -> triggers auto-ban escalation and resets counter
    const step2 = makeWarnCtx(threshold);
    await warnHandler(step2.ctx);

    expect(step2.banChatMember).toHaveBeenCalledOnce();
    expect(step2.banChatMember).toHaveBeenCalledWith(CHAT_ID, TARGET_ID, {
      until_date: 0,
    });
    expect(await redis.hget(warnsKey(CHAT_ID), String(TARGET_ID))).toBe("3");
    expect(step2.replies[0]).toContain("reply_banned:");
  });

  it("does NOT auto-ban at count == threshold if moderation.ban.enabled is false", async () => {
    const threshold = 3;
    const redis = getRedisClient();
    await redis.hset(warnsKey(CHAT_ID), String(TARGET_ID), "2");

    const { ctx, replies, banChatMember } = makeWarnCtx(threshold, false);
    await warnHandler(ctx);

    expect(banChatMember).not.toHaveBeenCalled();
    expect(replies[0]).toContain("reply_warned:");
    expect(replies[0]).toContain("Auto-ban would have triggered but is disabled");
  });
});
