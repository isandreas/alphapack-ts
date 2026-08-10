import { Menu } from "@grammyjs/menu";
import type { BotContext } from "../../types/context.js";
import { getGroupSettings, setGroupSetting } from "../../middlewares/group-settings.js";
import { getGroupAdmins, isGroupAdmin } from "../../middlewares/admin-guard.js";
import { getKnownGroups } from "./group-registry.js";
import { hasStartedBot } from "../mentions/user-registry.js";
import { logger } from "../../utils/logger.js";
import { knownGroupsKey, sessionKey, settingsEditKey } from "../../db/keys.js";
import { getRedisClient } from "../../db/redis.js";

/**
 * Returns active settings caption text depending on the submenu page.
 */
export async function getMenuCaption(_ctx: BotContext, chatId: number, page: string): Promise<string> {
  const settings = await getGroupSettings(chatId);
  const escape = (str: string) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const redis = getRedisClient();
  const groupName = (await redis.hget(knownGroupsKey(), String(chatId))) || "Group";
  const localeLabel = settings.locale === "id" ? "🇮🇩 Bahasa Indonesia" : "🇬🇧 English";

  switch (page) {
    case "main":
      return `⚙️ <b>Settings Panel — ${escape(groupName)}</b>\n\nSelect a configuration category below.`;

    case "rules":
      return `⚙️ <b>Group Rules Text</b>\n\nManage the rules text shown by /rules.\n\nCurrent Rules:\n<pre>${escape(settings.rules?.text || "No rules set yet")}</pre>`;

    case "guide":
      return `⚙️ <b>Group Guide Text</b>\n\nManage the guide text shown by /guide.\n\nCurrent Guide:\n<pre>${escape(settings.guide?.text || "No guide set yet")}</pre>`;

    case "moderation":
      return `⚙️ <b>Moderation Gating</b>\n\nToggle which moderation commands are enabled in this group.\n\n` +
        `• /warn: <b>${settings.moderation?.warn?.enabled ? "Enabled" : "Disabled"}</b>\n` +
        `• /mute: <b>${settings.moderation?.mute?.enabled ? "Enabled" : "Disabled"}</b>\n` +
        `• /tban: <b>${settings.moderation?.tban?.enabled ? "Enabled" : "Disabled"}</b>\n` +
        `• /ban: <b>${settings.moderation?.ban?.enabled ? "Enabled" : "Disabled"}</b>\n\n` +
        `Warn Threshold (Auto-ban): <b>${settings.warnThreshold} warns</b>`;

    case "anti-flood":
      return `⚙️ <b>Anti-Flood Settings</b>\n\nConfigure the flood guard trigger thresholds.\n\n` +
        `• Enabled: <b>${settings.floodGuard.enabled ? "Yes" : "No"}</b>\n` +
        `• Message Threshold: <b>${settings.floodGuard.messageThreshold} messages</b>\n` +
        `• Window Seconds: <b>${settings.floodGuard.windowSeconds}s</b>\n` +
        `• Punishment: <b>Mute for ${settings.floodGuard.punishment.durationSeconds}s</b>`;

    case "welcome":
      return `⚙️ <b>Welcome Message</b>\n\nConfigure the message sent when new members join.\n\n` +
        `• Enabled: <b>${settings.welcome.enabled ? "Yes" : "No"}</b>\n` +
        `• Template:\n<pre>${escape(settings.welcome.template)}</pre>\n` +
        `<b>Available keys:</b>\n` +
        `<code>{user_displayname}</code> — clickable mention link\n` +
        `<code>{user_id}</code> — Telegram user ID\n` +
        `<code>{user_username}</code> — @username or first name\n` +
        `<code>{group_name}</code> — group title`;

    case "goodbye":
      return `⚙️ <b>Goodbye Message</b>\n\nConfigure the message sent when members leave.\n\n` +
        `• Enabled: <b>${settings.goodbye.enabled ? "Yes" : "No"}</b>\n` +
        `• Template:\n<pre>${escape(settings.goodbye.template)}</pre>\n` +
        `<b>Available keys:</b>\n` +
        `<code>{user_displayname}</code> — clickable mention link\n` +
        `<code>{user_id}</code> — Telegram user ID\n` +
        `<code>{user_username}</code> — @username or first name\n` +
        `<code>{group_name}</code> — group title`;

    case "captcha":
      return `⚙️ <b>Captcha Gate</b>\n\nConfigure inline verification gate for new members.\n\n` +
        `• Enabled: <b>${settings.welcome.captcha.enabled ? "Yes" : "No"}</b>\n` +
        `• Timeout Seconds: <b>${settings.welcome.captcha.timeoutSeconds}s</b>`;

    case "admin-relay":
      return `⚙️ <b>@admin Relay Settings</b>\n\nConfigure DM relay of admin reports.\n\n` +
        `• Enabled: <b>${settings.mentions.adminRelay.enabled ? "Yes" : "No"}</b>\n` +
        `• Cooldown Seconds: <b>${settings.mentions.adminRelay.cooldownSeconds}s</b>`;

    case "username-notify":
      return `⚙️ <b>@username Mention Notifications</b>\n\nConfigure DM notifications for @username mentions.\n\n` +
        `• Enabled: <b>${settings.mentions.userNotify.enabled ? "Yes" : "No"}</b>\n` +
        `• Cooldown Seconds: <b>${settings.mentions.userNotify.cooldownSeconds}s</b>`;

    case "resolution":
      const bt = settings.customBanTemplate;
      return `⚙️ <b>Resolution Group (Ban Template)</b>\n\nConfigure custom message sent when users are auto-banned.\n\n` +
        `• Template Text:\n<pre>${escape(bt?.text || "Not configured (default i18n used)")}</pre>\n` +
        `• Button Label: <code>${escape(bt?.buttonLabel || "None")}</code>\n` +
        `• Button URL: <code>${escape(bt?.buttonUrl || "None")}</code>`;

    case "lang":
      return `⚙️ <b>Language Override</b>\n\nSelect the preferred locale for bot replies in this group.\n\nCurrent: <b>${localeLabel}</b>`;

    default:
      return "⚙️ Configuration Panel";
  }
}

/**
 * Updates the message caption.
 */
async function editCaption(ctx: BotContext, chatId: number, page: string): Promise<void> {
  try {
    const text = await getMenuCaption(ctx, chatId, page);
    await ctx.editMessageText(text, { parse_mode: "HTML" });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("message is not modified")) {
      return;
    }
    try {
      const caption = await getMenuCaption(ctx, chatId, page);
      await ctx.editMessageCaption({ caption, parse_mode: "HTML" });
    } catch (err2: unknown) {
      if (err2 instanceof Error && err2.message.includes("message is not modified")) {
        return;
      }
      logger.warn({ err, err2, page, chatId }, "Failed to edit settings message text or caption");
    }
  }
}

/**
 * Updates a setting in Redis and reloads it into the current request context in-memory.
 */
async function updateSettingAndReload(
  ctx: BotContext,
  chatId: number,
  key: string,
  value: string | number | boolean | null,
): Promise<void> {
  await setGroupSetting(chatId, key, value);
  ctx.groupSettings = await getGroupSettings(chatId);
}

// ── SUBMENUS DEFINITIONS ──────────────────────────────────────────────────────

/**
 * Saves the pending editor state to Redis and enters the settingsEditor conversation.
 *
 * We write to Redis (not ctx.session) because grammY conversations v2 replays the
 * conversation function on every incoming message, and during replay ctx.session is
 * undefined. The conversation reads back from Redis via conversation.external().
 */
async function enterEditor(
  ctx: BotContext,
  state: { chatId: number; settingKey: string; validation: string; submenu: string },
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const redis = getRedisClient();
  await redis.setex(settingsEditKey(userId), 300, JSON.stringify(state));
  await ctx.conversation.enter("settingsEditor");
}

// 1. Rules Menu
const rulesMenu = new Menu<BotContext>("rules-menu")
  .text("✏️ Rules", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await enterEditor(ctx, { chatId, settingKey: "rules.text", validation: "text", submenu: "rules" });
  })
  .row()
  .back("🔙 Back", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "main");
  });

// Guide Menu
const guideMenu = new Menu<BotContext>("guide-menu")
  .text("✏️ Guide", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await enterEditor(ctx, { chatId, settingKey: "guide.text", validation: "text", submenu: "guide" });
  })
  .row()
  .back("🔙 Back", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "main");
  });

// 3. Moderation Menu
const moderationMenu = new Menu<BotContext>("moderation-menu")
  .text("✅ Enable All", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await updateSettingAndReload(ctx, chatId, "moderation.warn.enabled", true);
    await updateSettingAndReload(ctx, chatId, "moderation.mute.enabled", true);
    await updateSettingAndReload(ctx, chatId, "moderation.tban.enabled", true);
    await updateSettingAndReload(ctx, chatId, "moderation.ban.enabled", true);
    await editCaption(ctx, chatId, "moderation");
    ctx.menu.update();
  })
  .text("🚫 Disable All", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await updateSettingAndReload(ctx, chatId, "moderation.warn.enabled", false);
    await updateSettingAndReload(ctx, chatId, "moderation.mute.enabled", false);
    await updateSettingAndReload(ctx, chatId, "moderation.tban.enabled", false);
    await updateSettingAndReload(ctx, chatId, "moderation.ban.enabled", false);
    await editCaption(ctx, chatId, "moderation");
    ctx.menu.update();
  })
  .row()
  .text(
    (ctx) => `Warn: ${ctx.groupSettings?.moderation?.warn?.enabled ? "🟢 ON" : "🔴 OFF"}`,
    async (ctx) => {
      const chatId = ctx.session.settingsChatId;
      if (!chatId) return;
      const current = ctx.groupSettings?.moderation?.warn?.enabled ?? false;
      await updateSettingAndReload(ctx, chatId, "moderation.warn.enabled", !current);
      await editCaption(ctx, chatId, "moderation");
      ctx.menu.update();
    }
  )
  .text(
    (ctx) => `Mute: ${ctx.groupSettings?.moderation?.mute?.enabled ? "🟢 ON" : "🔴 OFF"}`,
    async (ctx) => {
      const chatId = ctx.session.settingsChatId;
      if (!chatId) return;
      const current = ctx.groupSettings?.moderation?.mute?.enabled ?? false;
      await updateSettingAndReload(ctx, chatId, "moderation.mute.enabled", !current);
      await editCaption(ctx, chatId, "moderation");
      ctx.menu.update();
    }
  )
  .row()
  .text(
    (ctx) => `Tban: ${ctx.groupSettings?.moderation?.tban?.enabled ? "🟢 ON" : "🔴 OFF"}`,
    async (ctx) => {
      const chatId = ctx.session.settingsChatId;
      if (!chatId) return;
      const current = ctx.groupSettings?.moderation?.tban?.enabled ?? false;
      await updateSettingAndReload(ctx, chatId, "moderation.tban.enabled", !current);
      await editCaption(ctx, chatId, "moderation");
      ctx.menu.update();
    }
  )
  .text(
    (ctx) => `Ban: ${ctx.groupSettings?.moderation?.ban?.enabled ? "🟢 ON" : "🔴 OFF"}`,
    async (ctx) => {
      const chatId = ctx.session.settingsChatId;
      if (!chatId) return;
      const current = ctx.groupSettings?.moderation?.ban?.enabled ?? false;
      await updateSettingAndReload(ctx, chatId, "moderation.ban.enabled", !current);
      await editCaption(ctx, chatId, "moderation");
      ctx.menu.update();
    }
  )
  .row()
  .text("✏️ Edit Warn Threshold", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await enterEditor(ctx, { chatId, settingKey: "warnThreshold", validation: "number", submenu: "moderation" });
  })
  .row()
  .back("🔙 Back", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "main");
  });

// 4. Anti-Flood Menu
const antiFloodMenu = new Menu<BotContext>("anti-flood-menu")
  .text(
    (ctx) => `Flood Guard: ${ctx.groupSettings?.floodGuard?.enabled ? "🟢 ON" : "🔴 OFF"}`,
    async (ctx) => {
      const chatId = ctx.session.settingsChatId;
      if (!chatId) return;
      const current = ctx.groupSettings?.floodGuard?.enabled ?? false;
      await updateSettingAndReload(ctx, chatId, "floodGuard.enabled", !current);
      await editCaption(ctx, chatId, "anti-flood");
      ctx.menu.update();
    }
  )
  .row()
  .text("✏️ Edit Msg Threshold", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await enterEditor(ctx, { chatId, settingKey: "floodGuard.messageThreshold", validation: "number", submenu: "anti-flood" });
  })
  .text("✏️ Edit Window (secs)", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await enterEditor(ctx, { chatId, settingKey: "floodGuard.windowSeconds", validation: "number", submenu: "anti-flood" });
  })
  .row()
  .text("✏️ Edit Mute Duration (secs)", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await enterEditor(ctx, { chatId, settingKey: "floodGuard.punishment.durationSeconds", validation: "number", submenu: "anti-flood" });
  })
  .row()
  .back("🔙 Back", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "main");
  });

// 5. Welcome Menu
const welcomeMenu = new Menu<BotContext>("welcome-menu")
  .text(
    (ctx) => `Welcome: ${ctx.groupSettings?.welcome?.enabled ? "🟢 ON" : "🔴 OFF"}`,
    async (ctx) => {
      const chatId = ctx.session.settingsChatId;
      if (!chatId) return;
      const current = ctx.groupSettings?.welcome?.enabled ?? false;
      await updateSettingAndReload(ctx, chatId, "welcome.enabled", !current);
      await editCaption(ctx, chatId, "welcome");
      ctx.menu.update();
    }
  )
  .row()
  .text("✏️ Editing...", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await enterEditor(ctx, { chatId, settingKey: "welcome.template", validation: "template", submenu: "welcome" });
  })
  .row()
  .back("🔙 Back", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "main");
  });

// 6. Goodbye Menu
const goodbyeMenu = new Menu<BotContext>("goodbye-menu")
  .text(
    (ctx) => `Goodbye: ${ctx.groupSettings?.goodbye?.enabled ? "🟢 ON" : "🔴 OFF"}`,
    async (ctx) => {
      const chatId = ctx.session.settingsChatId;
      if (!chatId) return;
      const current = ctx.groupSettings?.goodbye?.enabled ?? false;
      await updateSettingAndReload(ctx, chatId, "goodbye.enabled", !current);
      await editCaption(ctx, chatId, "goodbye");
      ctx.menu.update();
    }
  )
  .row()
  .text("✏️ Editing...", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await enterEditor(ctx, { chatId, settingKey: "goodbye.template", validation: "template", submenu: "goodbye" });
  })
  .row()
  .back("🔙 Back", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "main");
  });

// 7. Captcha Menu
const captchaMenu = new Menu<BotContext>("captcha-menu")
  .text(
    (ctx) => `Captcha: ${ctx.groupSettings?.welcome?.captcha?.enabled ? "🟢 ON" : "🔴 OFF"}`,
    async (ctx) => {
      const chatId = ctx.session.settingsChatId;
      if (!chatId) return;
      const current = ctx.groupSettings?.welcome?.captcha?.enabled ?? false;
      await updateSettingAndReload(ctx, chatId, "welcome.captcha.enabled", !current);
      await editCaption(ctx, chatId, "captcha");
      ctx.menu.update();
    }
  )
  .row()
  .text("✏️ Edit Timeout (secs)", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await enterEditor(ctx, { chatId, settingKey: "welcome.captcha.timeoutSeconds", validation: "number", submenu: "captcha" });
  })
  .row()
  .back("🔙 Back", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "main");
  });

// 8. @Admin Menu
const adminMenu = new Menu<BotContext>("admin-menu")
  .text(
    (ctx) => `Admin Relay: ${ctx.groupSettings?.mentions?.adminRelay?.enabled ? "🟢 ON" : "🔴 OFF"}`,
    async (ctx) => {
      const chatId = ctx.session.settingsChatId;
      if (!chatId) return;
      const current = ctx.groupSettings?.mentions?.adminRelay?.enabled ?? false;
      await updateSettingAndReload(ctx, chatId, "mentions.adminRelay.enabled", !current);
      await editCaption(ctx, chatId, "admin-relay");
      ctx.menu.update();
    }
  )
  .row()
  .text("✏️ Edit Cooldown (secs)", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await enterEditor(ctx, { chatId, settingKey: "mentions.adminRelay.cooldownSeconds", validation: "number", submenu: "admin-relay" });
  })
  .row()
  .back("🔙 Back", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "main");
  });

// @username Notify Menu (renamed from "tag-menu" to "username-menu")
const usernameMenu = new Menu<BotContext>("username-menu")
  .text(
    (ctx) => `User Notify: ${ctx.groupSettings?.mentions?.userNotify?.enabled ? "🟢 ON" : "🔴 OFF"}`,
    async (ctx) => {
      const chatId = ctx.session.settingsChatId;
      if (!chatId) return;
      const current = ctx.groupSettings?.mentions?.userNotify?.enabled ?? false;
      await updateSettingAndReload(ctx, chatId, "mentions.userNotify.enabled", !current);
      await editCaption(ctx, chatId, "username-notify");
      ctx.menu.update();
    }
  )
  .row()
  .text("✏️ Edit Cooldown (secs)", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await enterEditor(ctx, { chatId, settingKey: "mentions.userNotify.cooldownSeconds", validation: "number", submenu: "username-notify" });
  })
  .row()
  .back("🔙 Back", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "main");
  });

// 10. Resolution Group Menu
const resolutionMenu = new Menu<BotContext>("resolution-menu")
  .text("✏️ Editing...", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.session.settingsChatId;
    if (userId && chatId) {
      const redis = getRedisClient();
      await redis.setex(settingsEditKey(userId), 300, JSON.stringify({ chatId }));
    }
    await ctx.conversation.enter("resolutionGroupEditor");
  })
  .row()
  .back("🔙 Back", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "main");
  });

// 11. Lang Menu
const langMenu = new Menu<BotContext>("lang-menu")
  .text("🇮🇩 Bahasa Indonesia", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await updateSettingAndReload(ctx, chatId, "locale", "id");
    await editCaption(ctx, chatId, "lang");
    ctx.menu.update();
  })
  .text("🇬🇧 English", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (!chatId) return;
    await updateSettingAndReload(ctx, chatId, "locale", "en");
    await editCaption(ctx, chatId, "lang");
    ctx.menu.update();
  })
  .row()
  .back("🔙 Back", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "main");
  });

// ── MAIN MENU DEFINITION ─────────────────────────────────────────────────────

export const settingsMenu = new Menu<BotContext>("settings-menu");

// Layout:
// [ 🛟 Moderation ]
// [ 📜 Rules ][ 🦮 Guide ]
// [ 👋 Welcome ][ 🏃 Goodbye ]
// [ 🗣️ Anti-Flood ][ 🛡️ Captcha ]
// [ 🚨 @admin ][ 🛎️ @username ]
// [ 🔤 Alphabets ][ 🖼️ Media ]
// [ 👼🏻 Resolution Group ]
// [ 💂🏼 Sentry ][ 🇮🇩 Lang ]
// [ ✅ Close ]
settingsMenu
  .submenu("🛟 Moderation", "moderation-menu", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "moderation");
  })
  .row()
  .submenu("📜 Rules", "rules-menu", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "rules");
  })
  .submenu("🦮 Guide", "guide-menu", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "guide");
  })
  .row()
  .submenu("👋 Welcome", "welcome-menu", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "welcome");
  })
  .submenu("🏃 Goodbye", "goodbye-menu", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "goodbye");
  })
  .row()
  .submenu("🗣️ Anti-Flood", "anti-flood-menu", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "anti-flood");
  })
  .submenu("🛡️ Captcha", "captcha-menu", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "captcha");
  })
  .row()
  .submenu("🚨 @admin", "admin-menu", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "admin-relay");
  })
  .submenu("🛎️ @username", "username-menu", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "username-notify");
  })
  .row()
  .text("🔤 Alphabets", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "🚧 Under Development", show_alert: true });
  })
  .text("🖼️ Media", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "🚧 Under Development", show_alert: true });
  })
  .row()
  .submenu("👼🏻 Resolution Group", "resolution-menu", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "resolution");
  })
  .row()
  .text("💂🏼 Sentry", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "🚧 Under Development", show_alert: true });
  })
  .submenu("🇮🇩 Lang", "lang-menu", async (ctx) => {
    const chatId = ctx.session.settingsChatId;
    if (chatId) await editCaption(ctx, chatId, "lang");
  })
  .row()
  .text("✅ Close", async (ctx) => {
    try {
      await ctx.menu.close();
      await ctx.editMessageText("⚙️ Settings closed. Run /settings again to reopen.", {
        parse_mode: "HTML",
      });
    } catch (e) {
      try {
        await ctx.editMessageCaption({
          caption: "⚙️ Settings closed. Run /settings again to reopen.",
          parse_mode: "HTML",
        });
      } catch (e2) {}
    }
    await ctx.answerCallbackQuery();
  });

// Bind all submenus
settingsMenu.register(rulesMenu);
settingsMenu.register(guideMenu);
settingsMenu.register(moderationMenu);
settingsMenu.register(antiFloodMenu);
settingsMenu.register(welcomeMenu);
settingsMenu.register(goodbyeMenu);
settingsMenu.register(captchaMenu);
settingsMenu.register(adminMenu);
settingsMenu.register(usernameMenu);
settingsMenu.register(resolutionMenu);
settingsMenu.register(langMenu);

// ── HELPER: SEND MENU PANEL ──────────────────────────────────────────────────

/**
 * Sends a settings panel message with photo header and reply markup.
 */
export async function sendSettingsMenu(ctx: BotContext, chatId: number, page: string): Promise<void> {
  const caption = await getMenuCaption(ctx, chatId, page);
  await ctx.reply(caption, {
    parse_mode: "HTML",
    reply_markup: settingsMenu,
  });
}

// ── COMMAND HANDLERS ─────────────────────────────────────────────────────────

/**
 * Main command handler for /settings (or !settings).
 */
export async function settingsCommandHandler(ctx: BotContext): Promise<void> {
  const chatType = ctx.chat?.type;
  const userId = ctx.from?.id;
  if (!userId) return;

  if (chatType === "group" || chatType === "supergroup") {
    const chatId = ctx.chat!.id;

    // 1. Require Admin
    const isAdmin = await isGroupAdmin(ctx, chatId, userId);
    if (!isAdmin) {
      await ctx.reply(ctx.t("error_admin_only"));
      return;
    }

    // 2. Check if admin has started the bot
    const isStarted = await hasStartedBot(userId);
    if (!isStarted) {
      const link = `https://t.me/${ctx.me.username}?start=settings_${chatId}`;
      const markup = {
        inline_keyboard: [
          [
            { text: "⚙️ Start Settings in DM", url: link }
          ]
        ]
      };
      await ctx.reply(ctx.t("settings_dm_start_prompt"), { reply_markup: markup });
      return;
    }

    // 3. User HAS started the bot, DM settings directly
    try {
      const redis = getRedisClient();
      const dmKey = sessionKey(userId, userId);
      const rawSession = await redis.get(dmKey);
      let sessionData = rawSession ? JSON.parse(rawSession) : {};
      sessionData.settingsChatId = chatId;
      await redis.set(dmKey, JSON.stringify(sessionData));

      // Get caption for main page
      const caption = await getMenuCaption(ctx, chatId, "main");
      // Send the settings menu to the user's DM instead of the group!
      await ctx.api.sendMessage(userId, caption, {
        parse_mode: "HTML",
        reply_markup: settingsMenu,
      });

      await ctx.reply("⚙️ Check your DMs.");
    } catch (err: unknown) {
      logger.error({ err, chatId, userId }, "Failed to send settings DM to admin from group trigger");
      await ctx.reply("❌ Unable to DM you settings. Please make sure you haven't blocked the bot and try again.");
    }

  } else if (chatType === "private") {
    // DM selection flow
    // Check deep-link payload
    const text = ctx.message?.text ?? "";
    const match = /^\/start\s+settings_(-?\d+)/i.exec(text);
    if (match) {
      const linkChatId = parseInt(match[1], 10);
      const isAdmin = await isGroupAdmin(ctx, linkChatId, userId);
      const adminIds = await getGroupAdmins(ctx, linkChatId);
      const isBotAdmin = adminIds.includes(ctx.me.id);

      if (isAdmin && isBotAdmin) {
        ctx.session.settingsChatId = linkChatId;
        await sendSettingsMenu(ctx, linkChatId, "main");
        return;
      }
    }    // Regular DM entry point: list candidate groups
    const loadingMsg = await ctx.reply(ctx.t("settings_checking_groups"));

    const knownGroups = await getKnownGroups();
    const candidateGroups: Array<{ chatId: number; title: string }> = [];

    for (const { chatId: groupChatId, title } of knownGroups) {
      const isAdmin = await isGroupAdmin(ctx, groupChatId, userId);
      if (isAdmin) {
        const adminIds = await getGroupAdmins(ctx, groupChatId);
        const isBotAdmin = adminIds.includes(ctx.me.id);
        if (isBotAdmin) {
          candidateGroups.push({ chatId: groupChatId, title });
        }
      }
    }

    try {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
    } catch (err) {
      logger.error({ err }, "Failed to delete settings_checking_groups loading message");
    }

    if (candidateGroups.length === 0) {
      await ctx.reply("⚠️ I'm not an admin in any group where you're an admin too.");
      return;
    }

    const keyboard = {
      inline_keyboard: candidateGroups.map((g) => [
        { text: g.title, callback_data: `sel_set:${g.chatId}` }
      ])
    };

    await ctx.reply(ctx.t("settings_select_group"), { reply_markup: keyboard });
  }
}

/**
 * Handles group selection callback query in DM.
 */
export async function settingsSelectCallbackHandler(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("sel_set:")) return;

  const chatId = parseInt(data.split(":")[1] || "0", 10);
  const userId = ctx.from?.id;
  if (!chatId || !userId) return;

  // Verify permissions one last time
  const isAdmin = await isGroupAdmin(ctx, chatId, userId);
  const adminIds = await getGroupAdmins(ctx, chatId);
  const isBotAdmin = adminIds.includes(ctx.me.id);

  if (!isAdmin || !isBotAdmin) {
    await ctx.answerCallbackQuery({ text: "❌ Permission denied.", show_alert: true });
    return;
  }

  ctx.session.settingsChatId = chatId;
  await ctx.answerCallbackQuery();
  // Clear select list message and show main settings panel
  try {
    await ctx.deleteMessage();
  } catch (e) {}

  await sendSettingsMenu(ctx, chatId, "main");
}
