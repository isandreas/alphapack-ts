import { GrammyError } from "grammy";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createBot } from "../../src/bot.js";
import { InMemoryRedisStore } from "../helpers/mock-redis.js";
import {
  approvedGroupsKey,
  knownGroupsKey,
  pendingApprovalGroupsKey,
} from "../../src/db/keys.js";
import { getRedisClient } from "../../src/db/redis.js";
import { env } from "../../src/config/env.js";
import {
  checkExistingGroupsOnStartup,
  isGroupApproved,
  isGroupBanned,
} from "../../src/features/settings/group-registry.js";

const store = new InMemoryRedisStore();

describe("Group approval workflow, startup check, /activegroups, and /exitgroup", () => {
  const BOT_ID = 900001;
  const OWNER_ID = 777777;
  const OTHER_USER_ID = 888888;
  const GROUP_A_ID = -1001111111111;
  const GROUP_B_ID = -1002222222222;
  let updateCounter = 8000;
  let messageCounter = 6000;
  let originalOwnerId: number | null;

  beforeEach(() => {
    store.install();
    store.clear();
    originalOwnerId = env.OWNER_ID;
    env.OWNER_ID = OWNER_ID;
  });

  afterEach(() => {
    env.OWNER_ID = originalOwnerId;
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
    const apiCalls: Array<{ method: string; payload: Record<string, any> }> = [];

    bot.api.config.use(async (_prev, method, payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (payload ?? {}) as Record<string, any>;
      apiCalls.push({ method, payload: p });

      if (method === "sendMessage") {
        return {
          ok: true,
          result: {
            message_id: ++messageCounter,
            date: Math.floor(Date.now() / 1000),
            chat: { id: p.chat_id, type: "supergroup" },
            text: p.text,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { ok: true, result: true } as any;
    });

    return { bot, apiCalls };
  }

  it("asks owner for approval when added to a group and stays completely silent in the group until approved", async () => {
    const { bot, apiCalls } = setupBot();
    const redis = getRedisClient();

    // 1. Bot is added to Group A (my_chat_member)
    await bot.handleUpdate({
      update_id: ++updateCounter,
      my_chat_member: {
        chat: { id: GROUP_A_ID, type: "supergroup", title: "Alpha Community" },
        from: { id: OTHER_USER_ID, is_bot: false, first_name: "Alice" },
        date: Math.floor(Date.now() / 1000),
        old_chat_member: {
          user: { id: BOT_ID, is_bot: true, first_name: "AlphaPack" },
          status: "left",
        },
        new_chat_member: {
          user: { id: BOT_ID, is_bot: true, first_name: "AlphaPack" },
          status: "administrator",
          can_be_edited: false,
          is_anonymous: false,
          can_manage_chat: true,
          can_delete_messages: true,
          can_manage_video_chats: false,
          can_restrict_members: true,
          can_promote_members: false,
          can_change_info: false,
          can_invite_users: true,
        },
      },
    });

    // Owner received 1 approval request DM
    const ownerDms = apiCalls.filter(
      (c) => c.method === "sendMessage" && c.payload.chat_id === OWNER_ID,
    );
    expect(ownerDms).toHaveLength(1);
    expect(String(ownerDms[0]?.payload.text)).toContain("Alpha Community");
    expect(String(ownerDms[0]?.payload.text)).toContain(String(GROUP_A_ID));
    expect(ownerDms[0]?.payload.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `grp_approve:${GROUP_A_ID}` },
          { text: "❌ Reject", callback_data: `grp_reject:${GROUP_A_ID}` },
        ],
      ],
    });

    // 1 message only sent to the group informing that the request will be evaluated by the bot owner
    const groupMsgsBeforeApproval = apiCalls.filter(
      (c) => c.method === "sendMessage" && c.payload.chat_id === GROUP_A_ID,
    );
    expect(groupMsgsBeforeApproval).toHaveLength(1);
    expect(String(groupMsgsBeforeApproval[0]?.payload.text)).toContain(
      "evaluated by the bot owner",
    );

    // 2. While waiting for owner confirmation, users send /ping, /start, and join in Group A
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: GROUP_A_ID, type: "supergroup", title: "Alpha Community" },
        from: { id: OTHER_USER_ID, is_bot: false, first_name: "Alice" },
        text: "!ping",
      },
    });
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: GROUP_A_ID, type: "supergroup", title: "Alpha Community" },
        from: { id: OTHER_USER_ID, is_bot: false, first_name: "Alice" },
        new_chat_members: [
          { id: 999999, is_bot: false, first_name: "Newbie" },
        ],
      },
    });

    // Still ONLY that 1 initial pending notice in the group, and no duplicate DM sent to owner
    expect(
      apiCalls.filter(
        (c) => c.method === "sendMessage" && c.payload.chat_id === GROUP_A_ID,
      ),
    ).toHaveLength(1);
    expect(
      apiCalls.filter(
        (c) => c.method === "sendMessage" && c.payload.chat_id === OWNER_ID,
      ),
    ).toHaveLength(1);
    expect(await isGroupApproved(GROUP_A_ID)).toBe(false);

    // 3. Owner clicks "✅ Approve"
    await bot.handleUpdate({
      update_id: ++updateCounter,
      callback_query: {
        id: "cb_approve_1",
        from: { id: OWNER_ID, is_bot: false, first_name: "Owner" },
        chat_instance: "ci_owner",
        data: `grp_approve:${GROUP_A_ID}`,
        message: {
          message_id: 100,
          date: Math.floor(Date.now() / 1000),
          chat: { id: OWNER_ID, type: "private" },
          text: "Approve?",
        },
      },
    });

    // Group is now saved in Redis approved_groups and removed from pending
    expect(await isGroupApproved(GROUP_A_ID)).toBe(true);
    expect(
      await redis.sismember(approvedGroupsKey(), String(GROUP_A_ID)),
    ).toBe(1);
    expect(
      await redis.sismember(pendingApprovalGroupsKey(), String(GROUP_A_ID)),
    ).toBe(0);

    // Group received approval notice informing admins they can configure with /settings
    const groupMsgsUponApproval = apiCalls.filter(
      (c) => c.method === "sendMessage" && c.payload.chat_id === GROUP_A_ID,
    );
    expect(groupMsgsUponApproval).toHaveLength(2);
    expect(String(groupMsgsUponApproval[1]?.payload.text)).toContain(
      "approved by the bot owner",
    );
    expect(String(groupMsgsUponApproval[1]?.payload.text)).toContain(
      "/settings",
    );

    // 4. Now "!ping" in Group A works and replies in the group
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: GROUP_A_ID, type: "supergroup", title: "Alpha Community" },
        from: { id: OTHER_USER_ID, is_bot: false, first_name: "Alice" },
        text: "!ping",
      },
    });

    const groupMsgsAfterApproval = apiCalls.filter(
      (c) => c.method === "sendMessage" && c.payload.chat_id === GROUP_A_ID,
    );
    expect(groupMsgsAfterApproval).toHaveLength(3);
    expect(String(groupMsgsAfterApproval[2]?.payload.text)).toContain("Pong");
  });

  it("says goodbye informing owner did not approve and leaves immediately when owner rejects", async () => {
    const { bot, apiCalls } = setupBot();
    const redis = getRedisClient();

    await redis.hset(knownGroupsKey(), String(GROUP_B_ID), "Rejected Group");
    await redis.sadd(pendingApprovalGroupsKey(), String(GROUP_B_ID));

    // Owner clicks "❌ Reject"
    await bot.handleUpdate({
      update_id: ++updateCounter,
      callback_query: {
        id: "cb_reject_1",
        from: { id: OWNER_ID, is_bot: false, first_name: "Owner" },
        chat_instance: "ci_owner",
        data: `grp_reject:${GROUP_B_ID}`,
        message: {
          message_id: 101,
          date: Math.floor(Date.now() / 1000),
          chat: { id: OWNER_ID, type: "private" },
          text: "Approve?",
        },
      },
    });

    // Sent goodbye message in the group informing that the owner doesn't approve
    const goodbyeCallIdx = apiCalls.findIndex(
      (c) => c.method === "sendMessage" && c.payload.chat_id === GROUP_B_ID,
    );
    const leaveCallIdx = apiCalls.findIndex(
      (c) => c.method === "leaveChat" && c.payload.chat_id === GROUP_B_ID,
    );

    expect(goodbyeCallIdx).toBeGreaterThan(-1);
    expect(leaveCallIdx).toBeGreaterThan(goodbyeCallIdx);
    expect(String(apiCalls[goodbyeCallIdx]?.payload.text)).toContain(
      "owner does not approve",
    );

    // Removed from Redis
    expect(await isGroupApproved(GROUP_B_ID)).toBe(false);
    expect(await redis.hget(knownGroupsKey(), String(GROUP_B_ID))).toBeNull();
    expect(
      await redis.sismember(pendingApprovalGroupsKey(), String(GROUP_B_ID)),
    ).toBe(0);
  });

  it("asks owner for approval for existing groups on startup and on first message in pre-existing groups", async () => {
    const { bot, apiCalls } = setupBot();
    const redis = getRedisClient();

    // Seed pre-existing group in known_groups (as if bot was already in the group when feature released)
    await redis.hset(knownGroupsKey(), String(GROUP_A_ID), "Legacy Group A");

    await checkExistingGroupsOnStartup(bot.api);

    const ownerDms = apiCalls.filter(
      (c) => c.method === "sendMessage" && c.payload.chat_id === OWNER_ID,
    );
    expect(ownerDms).toHaveLength(1);
    expect(String(ownerDms[0]?.payload.text)).toContain("Legacy Group A");
    expect(String(ownerDms[0]?.payload.text)).toContain(String(GROUP_A_ID));

    // Also test a pre-existing group that wasn't in known_groups yet when a message arrives
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: GROUP_B_ID, type: "supergroup", title: "Legacy Group B" },
        from: { id: OTHER_USER_ID, is_bot: false, first_name: "Bob" },
        text: "hello everyone",
      },
    });

    const ownerDmsAfter = apiCalls.filter(
      (c) => c.method === "sendMessage" && c.payload.chat_id === OWNER_ID,
    );
    expect(ownerDmsAfter).toHaveLength(2);
    expect(String(ownerDmsAfter[1]?.payload.text)).toContain("Legacy Group B");
    // 1 pending evaluation message sent to GROUP_B_ID
    const groupBMsgs = apiCalls.filter(
      (c) => c.method === "sendMessage" && c.payload.chat_id === GROUP_B_ID,
    );
    expect(groupBMsgs).toHaveLength(1);
    expect(String(groupBMsgs[0]?.payload.text)).toContain(
      "evaluated by the bot owner",
    );
  });

  it("supports /activegroups, !activegroups, /exitgroup <chat_id>, and !exitgroup <chat_id> for owner in private chat", async () => {
    const { bot, apiCalls } = setupBot();
    const redis = getRedisClient();

    await redis.hset(knownGroupsKey(), String(GROUP_A_ID), "Group One");
    await redis.hset(knownGroupsKey(), String(GROUP_B_ID), "Group Two");
    await redis.sadd(approvedGroupsKey(), String(GROUP_A_ID), String(GROUP_B_ID));

    // 1. Non-owner in DM is rejected
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: OTHER_USER_ID, type: "private" },
        from: { id: OTHER_USER_ID, is_bot: false, first_name: "Stranger" },
        text: "!activegroups",
      },
    });
    expect(String(apiCalls.at(-1)?.payload.text)).toContain("not authorized");

    // 2. Owner runs !activegroups in DM
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: OWNER_ID, type: "private" },
        from: { id: OWNER_ID, is_bot: false, first_name: "Owner" },
        text: "!activegroups",
      },
    });
    const listReply = String(apiCalls.at(-1)?.payload.text);
    expect(listReply).toContain("Group One");
    expect(listReply).toContain(String(GROUP_A_ID));
    expect(listReply).toContain("Group Two");
    expect(listReply).toContain(String(GROUP_B_ID));

    // 3. Owner runs !exitgroup <GROUP_A_ID> in DM
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: OWNER_ID, type: "private" },
        from: { id: OWNER_ID, is_bot: false, first_name: "Owner" },
        text: `!exitgroup ${GROUP_A_ID}`,
      },
    });

    expect(
      apiCalls.some(
        (c) => c.method === "leaveChat" && c.payload.chat_id === GROUP_A_ID,
      ),
    ).toBe(true);
    expect(await isGroupApproved(GROUP_A_ID)).toBe(false);
    expect(await isGroupApproved(GROUP_B_ID)).toBe(true);

    // 4. Owner runs /exitgroup <GROUP_B_ID> in DM
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: OWNER_ID, type: "private" },
        from: { id: OWNER_ID, is_bot: false, first_name: "Owner" },
        text: `/exitgroup ${GROUP_B_ID}`,
        entities: [{ type: "bot_command", offset: 0, length: 10 }],
      },
    });

    expect(
      apiCalls.some(
        (c) => c.method === "leaveChat" && c.payload.chat_id === GROUP_B_ID,
      ),
    ).toBe(true);
    expect(await isGroupApproved(GROUP_B_ID)).toBe(false);

    // 5. Owner runs /activegroups when no groups remain
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: OWNER_ID, type: "private" },
        from: { id: OWNER_ID, is_bot: false, first_name: "Owner" },
        text: "/activegroups",
        entities: [{ type: "bot_command", offset: 0, length: 13 }],
      },
    });
    expect(String(apiCalls.at(-1)?.payload.text)).toContain(
      "no active approved groups",
    );
  });

  it("supports !bangroup and !unbangroup, automatically leaving banned groups without spamming owner", async () => {
    const { bot, apiCalls } = setupBot();

    // 1. Owner bans GROUP_B_ID via !bangroup
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: OWNER_ID, type: "private" },
        from: { id: OWNER_ID, is_bot: false, first_name: "Owner" },
        text: `!bangroup ${GROUP_B_ID}`,
      },
    });

    expect(await isGroupBanned(GROUP_B_ID)).toBe(true);
    expect(String(apiCalls.at(-1)?.payload.text)).toContain("has been banned");

    const ownerDmCountBeforeInvite = apiCalls.filter(
      (c) => c.method === "sendMessage" && c.payload.chat_id === OWNER_ID,
    ).length;

    // 2. Someone invites the bot to banned GROUP_B_ID
    await bot.handleUpdate({
      update_id: ++updateCounter,
      my_chat_member: {
        chat: { id: GROUP_B_ID, type: "supergroup", title: "Spam Group" },
        from: { id: OTHER_USER_ID, is_bot: false, first_name: "Spammer" },
        date: Math.floor(Date.now() / 1000),
        old_chat_member: {
          user: { id: BOT_ID, is_bot: true, first_name: "AlphaPack" },
          status: "left",
        },
        new_chat_member: {
          user: { id: BOT_ID, is_bot: true, first_name: "AlphaPack" },
          status: "member",
        },
      },
    });

    // Bot did NOT send an approval request DM to the owner, and immediately called leaveChat
    const ownerDmCountAfterInvite = apiCalls.filter(
      (c) => c.method === "sendMessage" && c.payload.chat_id === OWNER_ID,
    ).length;
    expect(ownerDmCountAfterInvite).toBe(ownerDmCountBeforeInvite);
    expect(
      apiCalls.filter(
        (c) => c.method === "leaveChat" && c.payload.chat_id === GROUP_B_ID,
      ).length,
    ).toBeGreaterThanOrEqual(2); // once on !bangroup, once on my_chat_member

    // 3. Owner unbans GROUP_B_ID via !unbangroup
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: OWNER_ID, type: "private" },
        from: { id: OWNER_ID, is_bot: false, first_name: "Owner" },
        text: `!unbangroup ${GROUP_B_ID}`,
      },
    });

    expect(await isGroupBanned(GROUP_B_ID)).toBe(false);
    expect(String(apiCalls.at(-1)?.payload.text)).toContain("has been unbanned");

    // 4. Handles positive chat_id (missing leading '-') or invisible bidi chars in !bangroup and !exitgroup
    await bot.handleUpdate({
      update_id: ++updateCounter,
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: OWNER_ID, type: "private" },
        from: { id: OWNER_ID, is_bot: false, first_name: "Owner" },
        text: `!bangroup \u2068${Math.abs(GROUP_A_ID)}\u2069`,
      },
    });

    expect(await isGroupBanned(GROUP_A_ID)).toBe(true);
    expect(
      apiCalls.some(
        (c) => c.method === "leaveChat" && c.payload.chat_id === GROUP_A_ID,
      ),
    ).toBe(true);
  });

  it("re-prompts owner on startup despite stale pending marker, discovers groups from Redis keys, migrates basic→supergroup, and keeps approvals without TTL", async () => {
    const { bot, apiCalls } = setupBot();
    const redis = getRedisClient();
    const BASIC_ID = -4999999999;
    const DISCOVERED_ID = -1003333333333;

    // Stale pending marker for Group A (would previously block the DM forever)
    await redis.hset(knownGroupsKey(), String(GROUP_A_ID), "Stale Pending");
    await redis.sadd(pendingApprovalGroupsKey(), String(GROUP_A_ID));

    // Group only present through its Redis data (not in known_groups)
    await redis.hset(`alphapack:${DISCOVERED_ID}:warns`, "1", "1");

    // Approved basic group that was upgraded to GROUP_B_ID
    await redis.hset(knownGroupsKey(), String(BASIC_ID), "Upgraded Group");
    await redis.sadd(approvedGroupsKey(), String(BASIC_ID));
    await redis.expire(approvedGroupsKey(), 100);

    bot.api.config.use(async (prev, method, payload, signal) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (payload ?? {}) as Record<string, any>;
      if (method === "getChat") {
        if (p.chat_id === BASIC_ID) {
          throw new GrammyError(
            "Call to 'getChat' failed!",
            {
              ok: false,
              error_code: 400,
              description: "Bad Request: group chat was upgraded to a supergroup chat",
              parameters: { migrate_to_chat_id: GROUP_B_ID },
            },
            "getChat",
            p,
          );
        }
        if (p.chat_id === DISCOVERED_ID) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { ok: true, result: { id: DISCOVERED_ID, type: "supergroup", title: "Discovered" } } as any;
        }
      }
      return prev(method, payload, signal);
    });

    await checkExistingGroupsOnStartup(bot.api);

    expect(await isGroupApproved(GROUP_B_ID)).toBe(true);
    expect(await isGroupApproved(BASIC_ID)).toBe(false);
    expect(await redis.ttl(approvedGroupsKey())).toBe(-1);

    const ownerText = apiCalls
      .filter((c) => c.method === "sendMessage" && c.payload.chat_id === OWNER_ID)
      .map((c) => String(c.payload.text));
    expect(ownerText.some((t) => t.includes(String(GROUP_A_ID)))).toBe(true);
    expect(ownerText.some((t) => t.includes(String(DISCOVERED_ID)))).toBe(true);
  });
});

