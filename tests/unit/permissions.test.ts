import { describe, it, expect, beforeEach, vi } from "vitest";
import { isGroupAdmin, requireAdmin } from "../../src/middlewares/admin-guard.js";
import {
  isModerationFeatureEnabled,
  isAutoModerationExempt,
} from "../../src/utils/permissions.js";
import { InMemoryRedisStore } from "../helpers/mock-redis.js";
import type { BotContext } from "../../src/types/context.js";

const store = new InMemoryRedisStore();

describe("Permission checks (Part F)", () => {
  const CHAT_ID = -100111222333;
  const ADMIN_ID = 1001;
  const USER_ID = 2002;

  beforeEach(() => {
    store.install();
    store.clear();
  });

  describe("isGroupAdmin", () => {
    it("fetches administrators directly from Telegram API", async () => {
      const getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: ADMIN_ID, is_bot: false, first_name: "Admin" }, status: "creator" },
      ]);
      const ctx = { api: { getChatAdministrators } } as unknown as BotContext;

      expect(await isGroupAdmin(ctx, CHAT_ID, ADMIN_ID)).toBe(true);
      expect(await isGroupAdmin(ctx, CHAT_ID, USER_ID)).toBe(false);
      expect(getChatAdministrators).toHaveBeenCalledTimes(2);
    });

    it("returns false (conservative deny) when Telegram API throws", async () => {
      const getChatAdministrators = vi
        .fn()
        .mockRejectedValue(new Error("Telegram API unreachable"));
      const ctx = { api: { getChatAdministrators } } as unknown as BotContext;

      expect(await isGroupAdmin(ctx, CHAT_ID, ADMIN_ID)).toBe(false);
    });
  });

  describe("requireAdmin()", () => {
    it("calls next() when sender is a group admin", async () => {
      const middleware = requireAdmin();
      const next = vi.fn().mockResolvedValue(undefined);
      const ctx = {
        chat: { id: CHAT_ID, type: "supergroup" },
        from: { id: ADMIN_ID, is_bot: false, first_name: "Admin" },
        api: {
          getChatAdministrators: vi.fn().mockResolvedValue([
            { user: { id: ADMIN_ID }, status: "administrator" },
          ]),
        },
      } as unknown as BotContext;

      await middleware(ctx, next);
      expect(next).toHaveBeenCalledOnce();
    });

    it("silently drops update (does not call next) when sender is not an admin", async () => {
      const middleware = requireAdmin();
      const next = vi.fn().mockResolvedValue(undefined);
      const ctx = {
        chat: { id: CHAT_ID, type: "supergroup" },
        from: { id: USER_ID, is_bot: false, first_name: "Member" },
        api: {
          getChatAdministrators: vi.fn().mockResolvedValue([
            { user: { id: ADMIN_ID }, status: "administrator" },
          ]),
        },
      } as unknown as BotContext;

      await middleware(ctx, next);
      expect(next).not.toHaveBeenCalled();
    });

    it("always passes private (DM) updates through without admin check", async () => {
      const middleware = requireAdmin();
      const next = vi.fn().mockResolvedValue(undefined);
      const getChatAdministrators = vi.fn();
      const ctx = {
        chat: { id: USER_ID, type: "private" },
        from: { id: USER_ID, is_bot: false, first_name: "Member" },
        api: { getChatAdministrators },
      } as unknown as BotContext;

      await middleware(ctx, next);
      expect(next).toHaveBeenCalledOnce();
      expect(getChatAdministrators).not.toHaveBeenCalled();
    });
  });

  describe("isModerationFeatureEnabled", () => {
    it("returns true when feature is enabled and false when disabled or missing", () => {
      const ctxEnabled = {
        groupSettings: {
          moderation: {
            warn: { enabled: true },
            ban: { enabled: false },
            tban: { enabled: true },
            mute: { enabled: false },
          },
        },
      } as unknown as BotContext;

      expect(isModerationFeatureEnabled(ctxEnabled, "warn")).toBe(true);
      expect(isModerationFeatureEnabled(ctxEnabled, "ban")).toBe(false);
      expect(isModerationFeatureEnabled({} as BotContext, "warn")).toBe(false);
    });
  });

  describe("isAutoModerationExempt", () => {
    it("exempts bots immediately without hitting Telegram API", async () => {
      const getChatAdministrators = vi.fn();
      const ctx = { api: { getChatAdministrators } } as unknown as BotContext;

      const exempt = await isAutoModerationExempt(ctx, CHAT_ID, {
        id: 999,
        is_bot: true,
        first_name: "Bot",
      });
      expect(exempt).toBe(true);
      expect(getChatAdministrators).not.toHaveBeenCalled();
    });

    it("exempts group admins and does not exempt regular human members", async () => {
      const getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: ADMIN_ID }, status: "administrator" },
      ]);
      const ctx = { api: { getChatAdministrators } } as unknown as BotContext;

      expect(
        await isAutoModerationExempt(ctx, CHAT_ID, {
          id: ADMIN_ID,
          is_bot: false,
          first_name: "Admin",
        }),
      ).toBe(true);

      expect(
        await isAutoModerationExempt(ctx, CHAT_ID, {
          id: USER_ID,
          is_bot: false,
          first_name: "Member",
        }),
      ).toBe(false);
    });
  });
});

