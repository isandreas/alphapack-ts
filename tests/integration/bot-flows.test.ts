import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { createBot } from "../../src/bot.js";
import { InMemoryRedisStore } from "../helpers/mock-redis.js";
import {
  getGroupSettings,
  setGroupSetting,
} from "../../src/middlewares/group-settings.js";
import {
  adminCacheKey,
  knownGroupsKey,
  schedulerZsetKey,
  warnKey,
} from "../../src/db/keys.js";
import { getRedisClient } from "../../src/db/redis.js";

const store = new InMemoryRedisStore();

interface RecordedCall {
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
}

describe("Bot integration flows with grammY API transformer (Part G)", () => {
  const BOT_ID = 900001;
  const CHAT_ID = -1001234567890;
  const LOG_CHANNEL_ID = -1009876543210;
  const ADMIN_ID = 111111;
  const OFFENDER_ID = 222222;
  let updateCounter = 1000;
  let messageCounter = 500;

  beforeEach(() => {
    store.install();
    store.clear();
  });

  afterAll(async () => {
    // Clean up any local audit log directory created during test runs
    const auditDir = path.join(process.cwd(), "logs");
    try {
      await fs.promises.rm(auditDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function setupBotWithTransformer(options?: {
    channelBotCanPost?: boolean;
  }) {
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

    const apiCalls: RecordedCall[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleMockApiCall = async (method: string, payload: Record<string, any>) => {
      const p = payload ?? {};
      apiCalls.push({ method, payload: p });

      if (method === "getChatAdministrators") {
        return {
          ok: true,
          result: [
            {
              user: { id: ADMIN_ID, is_bot: false, first_name: "Admin" },
              status: "creator",
              is_anonymous: false,
            },
            {
              user: { id: BOT_ID, is_bot: true, first_name: "AlphaPack" },
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
          ],
        };
      }

      if (method === "getChatMember") {
        if (p.user_id === BOT_ID) {
          const canPost = options?.channelBotCanPost ?? true;
          return {
            ok: true,
            result: {
              user: { id: BOT_ID, is_bot: true, first_name: "AlphaPack" },
              status: "administrator",
              can_post_messages: canPost,
              can_be_edited: false,
              is_anonymous: false,
              can_manage_chat: true,
              can_delete_messages: true,
              can_manage_video_chats: false,
              can_restrict_members: false,
              can_promote_members: false,
              can_change_info: false,
              can_invite_users: false,
            },
          };
        }
        return {
          ok: true,
          result: {
            user: {
              id: p.user_id,
              is_bot: false,
              first_name: "Member",
              username: "member_user",
            },
            status: "member",
          },
        };
      }

      if (method === "sendMessage") {
        return {
          ok: true,
          result: {
            message_id: ++messageCounter,
            date: Math.floor(Date.now() / 1000),
            chat: { id: p.chat_id, type: "supergroup" },
            text: p.text,
          },
        };
      }

      return {
        ok: true,
        result: true,
      };
    };

    // 1. Install grammY API transformer on bot.api
    bot.api.config.use(async (_prev, method, payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await handleMockApiCall(method, (payload ?? {}) as Record<string, any>)) as any;
    });

    // 2. Also wire bot.clientConfig.fetch so child Api instances spawned by
    // @grammyjs/conversations (which copy protoApi.options from bot.clientConfig)
    // route through the exact same mock handler without making network requests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bot as any).clientConfig = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(bot as any).clientConfig,
      fetch: async (url: string, init?: { body?: string }) => {
        const method = String(url).split("/").pop() ?? "unknown";
        const payload = init?.body ? JSON.parse(init.body) : {};
        const data = await handleMockApiCall(method, payload);
        return {
          ok: true,
          status: 200,
          json: async () => data,
        };
      },
    };

    return { bot, apiCalls };
  }

  it("executes a full warn-to-auto-ban escalation sequence (Part G.1)", async () => {
    const { bot, apiCalls } = setupBotWithTransformer();
    const redis = getRedisClient();

    await setGroupSetting(CHAT_ID, "moderation.warn.enabled", true);
    await setGroupSetting(CHAT_ID, "moderation.ban.enabled", true);
    await setGroupSetting(CHAT_ID, "warnThreshold", 3);
    await setGroupSetting(CHAT_ID, "logChannelId", LOG_CHANNEL_ID);

    const makeWarnUpdate = (reason: string) => ({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: "supergroup" as const, title: "Test Group" },
        from: { id: ADMIN_ID, is_bot: false, first_name: "Admin" },
        text: `!warn ${reason}`,
        reply_to_message: {
          message_id: 42,
          date: Math.floor(Date.now() / 1000) - 10,
          chat: { id: CHAT_ID, type: "supergroup" as const, title: "Test Group" },
          from: {
            id: OFFENDER_ID,
            is_bot: false,
            first_name: "BadActor",
            username: "badactor",
          },
          text: "spam message",
        },
      },
    });

    // Warn 1 (1/3)
    await bot.handleUpdate(makeWarnUpdate("first strike"));
    expect(await redis.get(warnKey(CHAT_ID, OFFENDER_ID))).toBe("1");
    expect(apiCalls.some((c) => c.method === "banChatMember")).toBe(false);

    // Warn 2 (2/3)
    await bot.handleUpdate(makeWarnUpdate("second strike"));
    expect(await redis.get(warnKey(CHAT_ID, OFFENDER_ID))).toBe("2");
    expect(apiCalls.some((c) => c.method === "banChatMember")).toBe(false);

    // Warn 3 (3/3 -> auto-ban escalation!)
    await bot.handleUpdate(makeWarnUpdate("third strike"));

    const banCall = apiCalls.find((c) => c.method === "banChatMember");
    expect(banCall).toBeDefined();
    expect(banCall?.payload).toMatchObject({
      chat_id: CHAT_ID,
      user_id: OFFENDER_ID,
    });

    // Warn counter reached threshold (3)
    expect(await redis.get(warnKey(CHAT_ID, OFFENDER_ID))).toBe("3");

    // Log channel received 2 #warn cards and 1 #ban card
    const logChannelMsgs = apiCalls.filter(
      (c) => c.method === "sendMessage" && c.payload.chat_id === LOG_CHANNEL_ID,
    );
    expect(logChannelMsgs).toHaveLength(3);
    expect(logChannelMsgs[0]?.payload.text).toContain("#warn");
    expect(logChannelMsgs[1]?.payload.text).toContain("#warn");
    expect(logChannelMsgs[2]?.payload.text).toContain("#ban");
  });

  it("triggers flood-guard auto-mute when message threshold is reached (Part G.2)", async () => {
    const { bot, apiCalls } = setupBotWithTransformer();
    const redis = getRedisClient();

    await setGroupSetting(CHAT_ID, "floodGuard.enabled", true);
    await setGroupSetting(CHAT_ID, "floodGuard.messageThreshold", 3);
    await setGroupSetting(CHAT_ID, "floodGuard.windowSeconds", 10);
    await setGroupSetting(CHAT_ID, "floodGuard.punishment.durationSeconds", 300);
    await setGroupSetting(CHAT_ID, "logChannelId", LOG_CHANNEL_ID);

    const makeMemberMessage = (num: number) => ({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: "supergroup" as const, title: "Test Group" },
        from: {
          id: OFFENDER_ID,
          is_bot: false,
          first_name: "Flooder",
          username: "flooder",
        },
        text: `rapid message ${num}`,
      },
    });

    // Messages 1 and 2 are below threshold (3)
    await bot.handleUpdate(makeMemberMessage(1));
    await bot.handleUpdate(makeMemberMessage(2));
    expect(apiCalls.some((c) => c.method === "restrictChatMember")).toBe(false);

    // Message 3 hits threshold (3) -> auto-mute!
    await bot.handleUpdate(makeMemberMessage(3));

    const restrictCall = apiCalls.find((c) => c.method === "restrictChatMember");
    expect(restrictCall).toBeDefined();
    expect(restrictCall?.payload).toMatchObject({
      chat_id: CHAT_ID,
      user_id: OFFENDER_ID,
      permissions: { can_send_messages: false },
    });

    // Scheduled unmute entry added to scheduler zset
    const scheduled = await redis.zrangebyscore(schedulerZsetKey(), "-inf", "+inf");
    expect(scheduled).toHaveLength(1);
    expect(JSON.parse(scheduled[0]!)).toMatchObject({
      action: "unmute",
      chatId: CHAT_ID,
      userId: OFFENDER_ID,
    });

    // #floodmute log card posted to log channel
    const logCard = apiCalls.find(
      (c) =>
        c.method === "sendMessage" &&
        c.payload.chat_id === LOG_CHANNEL_ID &&
        String(c.payload.text).includes("#floodmute"),
    );
    expect(logCard).toBeDefined();
  });

  it("verifies channel permissions in !setlogchannel flow (both allowed and denied cases) (Part G.3)", async () => {
    const redis = getRedisClient();

    // Seed group registry and admin cache
    await redis.hset(knownGroupsKey(), String(CHAT_ID), "Alpha Group");
    await redis.set(adminCacheKey(CHAT_ID), JSON.stringify([ADMIN_ID, BOT_ID]));

    // ── Case A: Bot lacks can_post_messages permission in target channel ──
    {
      const { bot, apiCalls } = setupBotWithTransformer({
        channelBotCanPost: false,
      });

      // Step 1: Admin runs !setlogchannel in DM
      await bot.handleUpdate({
        update_id: ++updateCounter,
        message: {
          message_id: ++messageCounter,
          date: Math.floor(Date.now() / 1000),
          chat: { id: ADMIN_ID, type: "private" },
          from: { id: ADMIN_ID, is_bot: false, first_name: "Admin" },
          text: "!setlogchannel",
        },
      });

      // Step 2: Admin selects the group via inline callback button
      await bot.handleUpdate({
        update_id: ++updateCounter,
        callback_query: {
          id: "cb_select_1",
          from: { id: ADMIN_ID, is_bot: false, first_name: "Admin" },
          chat_instance: "ci_1",
          data: `slc:${CHAT_ID}`,
          message: {
            message_id: messageCounter,
            date: Math.floor(Date.now() / 1000),
            chat: { id: ADMIN_ID, type: "private" },
            text: "Select group",
          },
        },
      });

      // Step 3: Admin forwards a message from the channel
      await bot.handleUpdate({
        update_id: ++updateCounter,
        message: {
          message_id: ++messageCounter,
          date: Math.floor(Date.now() / 1000),
          chat: { id: ADMIN_ID, type: "private" },
          from: { id: ADMIN_ID, is_bot: false, first_name: "Admin" },
          text: "Forwarded from channel",
          forward_origin: {
            type: "channel",
            date: Math.floor(Date.now() / 1000) - 60,
            chat: {
              id: LOG_CHANNEL_ID,
              type: "channel",
              title: "Alpha Audit Logs",
            },
            message_id: 10,
          },
        },
      });

      const settingsAfterDeny = await getGroupSettings(CHAT_ID);
      expect(settingsAfterDeny.logChannelId).toBeNull();

      const dmReplies = apiCalls
        .filter((c) => c.method === "sendMessage" && c.payload.chat_id === ADMIN_ID)
        .map((c) => String(c.payload.text));
      expect(
        dmReplies.some((t) => t.includes("Post Messages")),
      ).toBe(true);
    }

    // ── Case B: Bot HAS administrator + can_post_messages permission ──
    {
      store.clear();
      await redis.hset(knownGroupsKey(), String(CHAT_ID), "Alpha Group");
      await redis.set(adminCacheKey(CHAT_ID), JSON.stringify([ADMIN_ID, BOT_ID]));

      const { bot, apiCalls } = setupBotWithTransformer({
        channelBotCanPost: true,
      });

      // Step 1: !setlogchannel in DM
      await bot.handleUpdate({
        update_id: ++updateCounter,
        message: {
          message_id: ++messageCounter,
          date: Math.floor(Date.now() / 1000),
          chat: { id: ADMIN_ID, type: "private" },
          from: { id: ADMIN_ID, is_bot: false, first_name: "Admin" },
          text: "!setlogchannel",
        },
      });

      // Step 2: Select group
      await bot.handleUpdate({
        update_id: ++updateCounter,
        callback_query: {
          id: "cb_select_2",
          from: { id: ADMIN_ID, is_bot: false, first_name: "Admin" },
          chat_instance: "ci_2",
          data: `slc:${CHAT_ID}`,
          message: {
            message_id: messageCounter,
            date: Math.floor(Date.now() / 1000),
            chat: { id: ADMIN_ID, type: "private" },
            text: "Select group",
          },
        },
      });

      // Step 3: Forward message from channel
      await bot.handleUpdate({
        update_id: ++updateCounter,
        message: {
          message_id: ++messageCounter,
          date: Math.floor(Date.now() / 1000),
          chat: { id: ADMIN_ID, type: "private" },
          from: { id: ADMIN_ID, is_bot: false, first_name: "Admin" },
          text: "Forwarded from channel",
          forward_origin: {
            type: "channel",
            date: Math.floor(Date.now() / 1000) - 60,
            chat: {
              id: LOG_CHANNEL_ID,
              type: "channel",
              title: "Alpha Audit Logs",
            },
            message_id: 11,
          },
        },
      });

      const settingsAfterAllow = await getGroupSettings(CHAT_ID);
      expect(settingsAfterAllow.logChannelId).toBe(LOG_CHANNEL_ID);

      // Confirmation posted to the log channel itself
      const channelConfirm = apiCalls.find(
        (c) => c.method === "sendMessage" && c.payload.chat_id === LOG_CHANNEL_ID,
      );
      expect(channelConfirm).toBeDefined();
      expect(String(channelConfirm?.payload.text)).toContain("Alpha Group");
    }
  });
});
