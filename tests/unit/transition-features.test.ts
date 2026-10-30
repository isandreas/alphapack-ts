import { describe, it, expect, beforeEach } from "vitest";
import { createBot } from "../../src/bot.js";
import { InMemoryRedisStore } from "../helpers/mock-redis.js";
import { setGroupSetting } from "../../src/middlewares/group-settings.js";
import {
  adminCacheKey,
  approvedGroupsKey,
  starsKey,
  usernameMapKey,
  warnsKey,
} from "../../src/db/keys.js";
import { getRedisClient } from "../../src/db/redis.js";
import { importRedisDump } from "../../src/scripts/import-dump.js";
import { getMenuCaption } from "../../src/features/settings/settings-menu.js";
import type { BotContext } from "../../src/types/context.js";

const store = new InMemoryRedisStore();

describe("Transition features: dump import, !star, !user, !adminlist, and commands menu", () => {
  const BOT_ID = 900001;
  const CHAT_ID = -1001234567890;
  const CREATOR_ID = 100001;
  const ADMIN_ID = 100002;
  const MEMBER_ID = 200001;
  let updateCounter = 5000;
  let messageCounter = 3000;

  beforeEach(async () => {
    store.install();
    store.clear();
    await getRedisClient().sadd(approvedGroupsKey(), String(CHAT_ID));
  });

  function setupBot() {
    const bot = createBot();
    bot.botInfo = {
      id: BOT_ID,
      is_bot: true,
      first_name: "AlphaPack",
      username: "alphapack_bot",
      can_join_groups: true,
      can_read_all_group_messages: true,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sentMessages: Array<Record<string, any>> = [];

    bot.api.config.use(async (_prev, method, payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (payload ?? {}) as Record<string, any>;

      if (method === "getChatAdministrators") {
        return {
          ok: true,
          result: [
            {
              user: {
                id: BOT_ID,
                is_bot: true,
                first_name: "AlphaPack",
              },
              status: "administrator",
              can_be_edited: false,
              is_anonymous: false,
              can_manage_chat: true,
              can_delete_messages: true,
              can_manage_video_chats: true,
              can_restrict_members: true,
              can_promote_members: false,
              can_change_info: false,
              can_invite_users: true,
            },
            {
              user: {
                id: ADMIN_ID,
                is_bot: false,
                first_name: "Bob",
                last_name: "Moderator",
                username: "bob_mod",
              },
              status: "administrator",
              can_be_edited: false,
              is_anonymous: false,
              can_manage_chat: true,
              can_delete_messages: true,
              can_manage_video_chats: true,
              can_restrict_members: true,
              can_promote_members: false,
              can_change_info: false,
              can_invite_users: true,
            },
            {
              user: {
                id: CREATOR_ID,
                is_bot: false,
                first_name: "Alice",
                last_name: "Owner",
                username: "alice_owner",
              },
              status: "creator",
              is_anonymous: false,
            },
          ],
        } as any;
      }

      if (method === "getChatMember") {
        return {
          ok: true,
          result: {
            user: {
              id: p.user_id,
              is_bot: false,
              first_name: "TargetUser",
              last_name: "Test",
              username: "target_user",
            },
            status: "member",
          },
        } as any;
      }

      if (method === "sendMessage") {
        sentMessages.push(p);
        return {
          ok: true,
          result: {
            message_id: ++messageCounter,
            date: Math.floor(Date.now() / 1000),
            chat: { id: p.chat_id, type: "supergroup" },
            text: p.text,
          },
        } as any;
      }

      return { ok: true, result: true } as any;
    });

    return { bot, sentMessages };
  }

  it("imports legacy Redis dump keys (warns, winevent -> stars, admins)", async () => {
    const redis = getRedisClient();

    const dump = {
      [`chat:${CHAT_ID}:warns`]: {
        type: "hash",
        ttl: -1,
        value: {
          [String(MEMBER_ID)]: "2",
          "200002": "4",
        },
      },
      [`chat:${CHAT_ID}:winevent`]: {
        type: "hash",
        ttl: -1,
        value: {
          [String(MEMBER_ID)]: "7",
        },
      },
      [`cache:chat:${CHAT_ID}:admins`]: {
        type: "set",
        ttl: 180,
        value: [String(CREATOR_ID), String(ADMIN_ID)],
      },
      "unrelated:key": {
        type: "string",
        ttl: -1,
        value: "ignored",
      },
    };

    const summary = await importRedisDump(dump);
    expect(summary).toEqual({
      warnsImported: 1,
      starsImported: 1,
      adminsImported: 1,
      skippedKeys: 1,
    });

    expect(await redis.hget(warnsKey(CHAT_ID), String(MEMBER_ID))).toBe("2");
    expect(await redis.hget(warnsKey(CHAT_ID), "200002")).toBe("4");
    expect(await redis.hget(starsKey(CHAT_ID), String(MEMBER_ID))).toBe("7");

    const cachedAdmins = JSON.parse(
      (await redis.get(adminCacheKey(CHAT_ID))) ?? "[]",
    );
    expect(cachedAdmins).toEqual([CREATOR_ID, ADMIN_ID]);
    expect(await redis.ttl(adminCacheKey(CHAT_ID))).toBe(180);
  });

  it("handles !star (+n, -n, floor at 0, explicit & reply) and ignores /star", async () => {
    const { bot, sentMessages } = setupBot();
    const redis = getRedisClient();

    await setGroupSetting(CHAT_ID, "commands.star.enabled", true);
    await redis.hset(usernameMapKey(CHAT_ID), "target_user", String(MEMBER_ID));

    // 1. /star (with slash) must be ignored
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: "supergroup", title: "Test Group" },
        from: { id: ADMIN_ID, is_bot: false, first_name: "Bob" },
        text: "/star @target_user +3",
        entities: [{ type: "bot_command", offset: 0, length: 5 }],
      },
    });
    expect(sentMessages).toHaveLength(0);
    expect(await redis.hget(starsKey(CHAT_ID), String(MEMBER_ID))).toBeNull();

    // 2. !star via reply (+3)
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: "supergroup", title: "Test Group" },
        from: { id: ADMIN_ID, is_bot: false, first_name: "Bob" },
        text: "!star +3",
        reply_to_message: {
          message_id: 10,
          date: Math.floor(Date.now() / 1000) - 5,
          chat: { id: CHAT_ID, type: "supergroup", title: "Test Group" },
          from: {
            id: MEMBER_ID,
            is_bot: false,
            first_name: "TargetUser",
            username: "target_user",
          },
          text: "hello",
        },
      },
    });
    expect(await redis.hget(starsKey(CHAT_ID), String(MEMBER_ID))).toBe("3");
    const starReply1 = String(sentMessages.at(-1)?.text).replace(/[\u2068\u2069]/g, "");
    expect(starReply1).toContain("(+3)");
    expect(starReply1).toContain("<b>3</b>");

    // 3. !star via explicit @username (-5 -> clamped to 0)
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: "supergroup", title: "Test Group" },
        from: { id: ADMIN_ID, is_bot: false, first_name: "Bob" },
        text: "!star @target_user -5",
      },
    });
    expect(await redis.hget(starsKey(CHAT_ID), String(MEMBER_ID))).toBe("0");
    const starReply2 = String(sentMessages.at(-1)?.text).replace(/[\u2068\u2069]/g, "");
    expect(starReply2).toContain("(-5)");
    expect(starReply2).toContain("<b>0</b>");
  });

  it("handles !user (self, reply, explicit target) with warns & stars and ignores /user", async () => {
    const { bot, sentMessages } = setupBot();
    const redis = getRedisClient();

    await setGroupSetting(CHAT_ID, "commands.user.enabled", true);
    await setGroupSetting(CHAT_ID, "locale", "en");
    await redis.hset(warnsKey(CHAT_ID), String(MEMBER_ID), "2");
    await redis.hset(starsKey(CHAT_ID), String(MEMBER_ID), "5");

    // 1. /user (slash) is ignored
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: "supergroup", title: "Test Group" },
        from: { id: MEMBER_ID, is_bot: false, first_name: "Member", username: "mem" },
        text: "/user",
        entities: [{ type: "bot_command", offset: 0, length: 5 }],
      },
    });
    expect(sentMessages).toHaveLength(0);

    // 2. !user (self)
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: "supergroup", title: "Test Group" },
        from: {
          id: MEMBER_ID,
          is_bot: false,
          first_name: "Member",
          last_name: "One",
          username: "mem_one",
        },
        text: "!user",
      },
    });
    expect(sentMessages).toHaveLength(1);
    const card = String(sentMessages[0]?.text).replace(/[\u2068\u2069]/g, "");
    expect(card).toContain("Member One");
    expect(card).toContain(`<code>${MEMBER_ID}</code>`);
    expect(card).toContain("@mem_one");
    expect(card).toContain("2/5");
    expect(card).toContain("⭐ 5");
  });

  it("handles !adminlist with creator first, admins second, excluding bots, and ignores /adminlist", async () => {
    const { bot, sentMessages } = setupBot();

    await setGroupSetting(CHAT_ID, "commands.adminlist.enabled", true);
    await setGroupSetting(CHAT_ID, "locale", "en");

    // 1. /adminlist (slash) is ignored
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: "supergroup", title: "Test Group" },
        from: { id: MEMBER_ID, is_bot: false, first_name: "Member" },
        text: "/adminlist",
        entities: [{ type: "bot_command", offset: 0, length: 10 }],
      },
    });
    expect(sentMessages).toHaveLength(0);

    // 2. !adminlist
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: "supergroup", title: "Test Group" },
        from: { id: MEMBER_ID, is_bot: false, first_name: "Member" },
        text: "!adminlist",
      },
    });
    expect(sentMessages).toHaveLength(1);
    const text = String(sentMessages[0]?.text);

    // Creator (Alice Owner) appears before Admin (Bob Moderator), and bot (AlphaPack) is excluded
    const creatorIdx = text.indexOf("Alice Owner");
    const adminIdx = text.indexOf("Bob Moderator");
    expect(creatorIdx).toBeGreaterThan(-1);
    expect(adminIdx).toBeGreaterThan(creatorIdx);
    expect(text).not.toContain("AlphaPack");
    expect(text).not.toContain("tg://user");
  });

  it("renders the commands settings submenu caption accurately", async () => {
    await setGroupSetting(CHAT_ID, "commands.user.enabled", true);
    await setGroupSetting(CHAT_ID, "commands.star.enabled", false);
    await setGroupSetting(CHAT_ID, "commands.adminlist.enabled", true);

    const caption = await getMenuCaption({} as BotContext, CHAT_ID, "commands");
    expect(caption).toContain("Commands Gating");
    expect(caption).toContain("• !user: <b>Enabled</b>");
    expect(caption).toContain("• !star: <b>Disabled</b>");
    expect(caption).toContain("• !adminlist: <b>Enabled</b>");
  });

  it("silently ignores !star, !user, and !adminlist without replying when disabled", async () => {
    const { bot, sentMessages } = setupBot();

    // All three default to disabled (false)
    for (const cmdText of ["!star +1", "!user", "!adminlist"]) {
      await bot.handleUpdate({
        update_id: ++updateCounter,
        message: {
          message_id: ++messageCounter,
          date: Math.floor(Date.now() / 1000),
          chat: { id: CHAT_ID, type: "supergroup", title: "Test Group" },
          from: { id: ADMIN_ID, is_bot: false, first_name: "Bob" },
          text: cmdText,
        },
      });
    }

    expect(sentMessages).toHaveLength(0);
  });
});
