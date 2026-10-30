import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Api } from "grammy";
import {
  registerBotCommands,
  REGULAR_GROUP_COMMANDS,
  ADMIN_GROUP_COMMANDS,
  PRIVATE_CHAT_COMMANDS,
  buildBotCommands,
} from "../../src/utils/bot-commands.js";
import { createBot, i18nInstance } from "../../src/bot.js";
import { InMemoryRedisStore } from "../helpers/mock-redis.js";

const store = new InMemoryRedisStore();

describe("Bot commands autocomplete registration (setMyCommands)", () => {
  beforeEach(() => {
    store.install();
    store.clear();
  });

  it("builds localized command lists for English and Indonesian", () => {
    // Initialize bot so i18nInstance is loaded
    createBot();

    const enGroupCommands = buildBotCommands(REGULAR_GROUP_COMMANDS, "en", i18nInstance);
    expect(enGroupCommands).toEqual([
      { command: "rules", description: "Display group rules" },
      { command: "guide", description: "Display group guide & links" },
      { command: "ping", description: "Check bot latency and status" },
    ]);

    const idGroupCommands = buildBotCommands(REGULAR_GROUP_COMMANDS, "id", i18nInstance);
    expect(idGroupCommands).toEqual([
      { command: "rules", description: "Lihat peraturan grup" },
      { command: "guide", description: "Lihat panduan dan tautan grup" },
      { command: "ping", description: "Cek latensi dan status bot" },
    ]);
  });

  it("registers scoped commands with Telegram API for regular users, admins, and private DMs", async () => {
    createBot();

    const calls: Array<{ commands: any[]; options?: any }> = [];
    const mockApi = {
      setMyCommands: vi.fn(async (commands, options) => {
        calls.push({ commands, options });
        return true;
      }),
    } as unknown as Api;

    await registerBotCommands(mockApi, i18nInstance);

    // 3 scopes * 2 languages (default + id) = 6 calls
    expect(calls).toHaveLength(6);

    // 1. Regular users in all group chats (default / en)
    const regularGroupEn = calls.find(
      (c) => c.options?.scope?.type === "all_group_chats" && !c.options?.language_code,
    );
    expect(regularGroupEn).toBeDefined();
    expect(regularGroupEn?.commands.map((c) => c.command)).toEqual(["rules", "guide", "ping"]);

    // 2. Regular users in all group chats (id)
    const regularGroupId = calls.find(
      (c) => c.options?.scope?.type === "all_group_chats" && c.options?.language_code === "id",
    );
    expect(regularGroupId).toBeDefined();
    expect(regularGroupId?.commands.find((c) => c.command === "rules")?.description).toBe("Lihat peraturan grup");

    // 3. Group administrators in all group chats (default / en)
    const adminGroupEn = calls.find(
      (c) => c.options?.scope?.type === "all_chat_administrators" && !c.options?.language_code,
    );
    expect(adminGroupEn).toBeDefined();
    const adminCmds = adminGroupEn?.commands.map((c) => c.command);
    expect(adminCmds).toContain("warn");
    expect(adminCmds).toContain("mute");
    expect(adminCmds).toContain("ban");
    expect(adminCmds).toContain("settings");
    expect(adminCmds).toContain("rules");

    // 4. Group administrators in all group chats (id)
    const adminGroupId = calls.find(
      (c) => c.options?.scope?.type === "all_chat_administrators" && c.options?.language_code === "id",
    );
    expect(adminGroupId).toBeDefined();
    expect(adminGroupId?.commands.find((c) => c.command === "warn")?.description).toBe("Beri peringatan kepada anggota");

    // 5. Private chats (default / en)
    const privateChatEn = calls.find(
      (c) => c.options?.scope?.type === "all_private_chats" && !c.options?.language_code,
    );
    expect(privateChatEn).toBeDefined();
    expect(privateChatEn?.commands.map((c) => c.command)).toEqual(["start", "settings", "ping"]);

    // 6. Private chats (id)
    const privateChatId = calls.find(
      (c) => c.options?.scope?.type === "all_private_chats" && c.options?.language_code === "id",
    );
    expect(privateChatId).toBeDefined();
    expect(privateChatId?.commands.find((c) => c.command === "start")?.description).toBe("Mulai bot dan lihat info");
  });
});
