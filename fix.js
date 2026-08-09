const fs = require('fs');
const path = require('path');

function replaceInFile(filepath, replacements) {
  let content = fs.readFileSync(filepath, 'utf8');
  for (const [from, to] of replacements) {
    content = content.replace(from, to);
  }
  fs.writeFileSync(filepath, content);
}

replaceInFile('src/utils/target-resolver.ts', [
  [
    `export interface TargetResolution {
  userId: number;
  username?: string;
  reason: string;
}`,
    `export interface TargetResolution {
  userId: number;
  username?: string | undefined;
  reason: string;
}`
  ]
]);

replaceInFile('src/utils/notify.ts', [
  [
    `export interface NotifyOptions {
  chatId: number;
  userId: number;
  username?: string;
  adminId: number;
  adminUsername?: string;
  action: "warn" | "mute" | "tban" | "ban" | "unmute" | "unban";
  reason?: string;
  duration?: string;
  warnCount?: number;
  warnThreshold?: number;
  customMessage?: {
    text: string;
    buttonLabel?: string;
    buttonUrl?: string;
  };
}`,
    `export interface NotifyOptions {
  chatId: number;
  userId: number;
  username?: string | undefined;
  adminId: number;
  adminUsername?: string | undefined;
  action: "warn" | "mute" | "tban" | "ban" | "unmute" | "unban";
  reason?: string | undefined;
  duration?: string | undefined;
  warnCount?: number | undefined;
  warnThreshold?: number | undefined;
  customMessage?: {
    text: string;
    buttonLabel?: string | undefined;
    buttonUrl?: string | undefined;
  } | undefined;
}`
  ],
  [
    `group: ctx.chat && "title" in ctx.chat ? ctx.chat.title : "the group",`,
    `group: (ctx.chat && "title" in ctx.chat && ctx.chat.title) ? ctx.chat.title : "the group",`
  ],
  [
    `await ctx.api.sendMessage(opts.userId, dmText, { reply_markup: replyMarkup });`,
    `const sendOpts: any = {};
    if (replyMarkup) sendOpts.reply_markup = replyMarkup;
    await ctx.api.sendMessage(opts.userId, dmText, sendOpts);`
  ]
]);

replaceInFile('src/features/moderation/ban.ts', [
  [
    `export interface BanOptions {
  chatId: number;
  targetId: number;
  targetUsername?: string;
  adminId: number;
  adminUsername?: string;
  reason: string;
  durationSeconds?: number;
  isAutoBan?: boolean; // True if this ban was triggered automatically (e.g. warn threshold)
}`,
    `export interface BanOptions {
  chatId: number;
  targetId: number;
  targetUsername?: string | undefined;
  adminId: number;
  adminUsername?: string | undefined;
  reason: string;
  durationSeconds?: number | undefined;
  isAutoBan?: boolean | undefined; 
}`
  ]
]);

replaceInFile('src/features/moderation/mute.ts', [
  [
    `    await ctx.api.restrictChatMember(chatId, target.userId, {
      permissions: {
        can_send_messages: false,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false,
        can_manage_topics: false,
      },
      until_date: until,
    });`,
    `    await ctx.api.restrictChatMember(
      chatId, 
      target.userId, 
      {
        can_send_messages: false,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false,
        can_manage_topics: false,
      },
      { until_date: until }
    );`
  ],
  [
    `    await ctx.api.restrictChatMember(chatId, target.userId, {
      permissions: {
        can_send_messages: true,
        can_send_audios: true,
        can_send_documents: true,
        can_send_photos: true,
        can_send_videos: true,
        can_send_video_notes: true,
        can_send_voice_notes: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false,
        can_manage_topics: false,
      },
    });`,
    `    await ctx.api.restrictChatMember(
      chatId, 
      target.userId, 
      {
        can_send_messages: true,
        can_send_audios: true,
        can_send_documents: true,
        can_send_photos: true,
        can_send_videos: true,
        can_send_video_notes: true,
        can_send_voice_notes: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false,
        can_manage_topics: false,
      }
    );`
  ]
]);

replaceInFile('src/features/scheduler/action-scheduler.ts', [
  [
    `      await bot.api.restrictChatMember(item.chatId, item.userId, {
        permissions: {
          can_send_messages: true,
          can_send_audios: true,
          can_send_documents: true,
          can_send_photos: true,
          can_send_videos: true,
          can_send_video_notes: true,
          can_send_voice_notes: true,
          can_send_polls: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
          can_change_info: false,
          can_invite_users: false,
          can_pin_messages: false,
          can_manage_topics: false,
        },
      });`,
    `      await bot.api.restrictChatMember(
        item.chatId, 
        item.userId, 
        {
          can_send_messages: true,
          can_send_audios: true,
          can_send_documents: true,
          can_send_photos: true,
          can_send_videos: true,
          can_send_video_notes: true,
          can_send_voice_notes: true,
          can_send_polls: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
          can_change_info: false,
          can_invite_users: false,
          can_pin_messages: false,
          can_manage_topics: false,
        }
      );`
  ]
]);
