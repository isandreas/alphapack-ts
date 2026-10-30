ping-response = 🏓 Pong! Bot is alive and running.
start-greeting =
    Hello! I'm AlphaPack 🤖
    I can help you manage your group. Add me to a group and give me admin permissions!

# Errors
error_group_only = ❌ This command can only be used in a group.
error_immune_bot = ❌ I cannot perform moderation actions on myself.
error_immune_self = ❌ You cannot perform moderation actions on yourself.
error_immune_admin = ❌ Target is an administrator and cannot be moderated.
error_ban_failed = ❌ Failed to ban the user. Please check my permissions.
error_unban_failed = ❌ Failed to unban the user.
error_mute_failed = ❌ Failed to mute the user. Please check my permissions.
error_unmute_failed = ❌ Failed to unmute the user.
error_admin_only = ❌ This command is for administrators only.
error_owner_only = ❌ You are not authorized to use this command.

# Usage
usage_warn = ⚠️ Usage: /warn <user_id> [reason] or reply to a message with /warn [reason]
usage_mute = ⚠️ Usage: /mute <user_id> [duration] [reason] or reply to a message with /mute [duration] [reason]
usage_unmute = ⚠️ Usage: /unmute <user_id> or reply to a message with /unmute
usage_ban = ⚠️ Usage: /ban <user_id> [reason] or reply to a message with /ban [reason]
usage_tban = ⚠️ Usage: /tban <user_id> <duration> [reason] or reply to a message with /tban <duration> [reason]
usage_unban = ⚠️ Usage: /unban <user_id> or reply to a message with /unban

reply_warned =
    ⚠️ { $target } has been warned ({ $count }/{ $threshold }).

    Reason: { $reason }
reply_muted =
    🔇 { $target } has been muted for { $duration }.

    Reason: { $reason }
reply_unmuted = 🔊 { $target } has been unmuted.
reply_banned =
    🔨 { $target } has been permanently banned.

    Reason: { $reason }
reply_tbanned =
    🔨 { $target } has been temporarily banned for { $duration }.

    Reason: { $reason }
reply_unbanned = 🕊️ { $target } has been unbanned.
reply_unbanned_reset = 🕊️ { $target } has been unbanned. (Warning counter reset to 0)
reply_flood_muted = 🔇 { $target } has been auto-muted for { $duration } for sending messages too quickly.

# Helpers
no_reason_provided = -
reason_warn_limit_reached = Automatically banned for reaching the warning limit.
error_generic = ❌ An error occurred.
btn_remove_warn = ➖ Remove Warning (-1)
warn_removed = ✅ Warning removed.
reply_warn_removed = ✅ Warning removed for { $target } ({ $count }/{ $threshold }).
rejoin_group_btn = 🔗 Rejoin Group
group_tban_expired = 🕊️ { $target }'s temporary ban has expired.

# DM Notifications
dm_warn = ⚠️ You have been warned in { $group } ({ $count }/{ $threshold }).
    Reason: { $reason }

dm_mute = 🔇 You have been muted in { $group } for { $duration }.
    Reason: { $reason }

dm_tban = 🔨 You have been temporarily banned from { $group } for { $duration }.
    Reason: { $reason }

dm_ban = 🔨 You have been permanently banned from { $group }.
    Reason: { $reason }

dm_unmute = 🔊 Your mute in { $group } has been lifted.
dm_unban = 🕊️ Your ban in { $group } has been lifted.
dm_tban_expired = 🕊️ Your temporary ban in { $group } has expired.
dm_unmute_expired = 🔊 Your temporary mute in { $group } has expired.
dm_flood_mute = 🔇 You have been auto-muted in { $group } for { $duration } for sending messages too quickly.

# Log Channel Setup
setlogchannel_dm_only = ❌ This command can only be used in a DM with the bot. Send me a private message!
setlogchannel_no_groups = You are not an admin of any group this bot is currently in.
setlogchannel_select_group = Select the group you want to configure a log channel for:
setlogchannel_forward_prompt = Forward any message from the channel you want to use as the log channel for <b>{ $group }</b>.
setlogchannel_not_channel_forward = ❌ That doesn't look like a forwarded message from a channel. Please forward a message from the channel you want to use.
setlogchannel_bot_not_admin = ❌ I'm not an admin with "Post Messages" permission in that channel. Please add me as an admin in the channel first, then try !setlogchannel again.
setlogchannel_success = ✅ Log channel has been set for <b>{ $group }</b>.
setlogchannel_channel_confirm = ✅ This channel is now the log channel for { $group }.
setlogchannel_checking = ⏳ Checking your admin status across groups...

# Mentions & Relay
error_admin_relay_cooldown = ⚠️ Please wait before calling admins again.
reply_admin_notified = 🔔 Admins have been notified.
dm_user_mentioned = 💬 You were mentioned in <b>{ $group }</b> by <b>{ $sender }</b>.

# Settings Control Panel (Phase 5)
error_moderation_disabled = ⚠️ The { $feature } command is currently disabled in this group.
rules_not_set = ⚠️ No rules have been set yet for this group.
settings_dm_start_prompt = ⚠️ Please start a DM with the bot to open the settings panel.
settings_checking_groups = ⏳ Finding groups where you and the bot are both admins...
settings_select_group = Select the group you want to configure:

# Alphabet & Media Filters — Group Notice (Phase 6)
# Sent to the group chat when a message is removed by an auto-moderation filter.
reply_restriction_removed = 🚫 Message Removed. Reason: { $reason }

# Alphabet filter — reason strings (used in the group notice and the log card)
reason_alphabet_cyrillic = message contained Cyrillic script (restricted)
reason_alphabet_arabic = message contained Arabic script (restricted)
reason_alphabet_cjk = message contained CJK script (restricted)
reason_alphabet_thai = message contained Thai script (restricted)
reason_alphabet_hebrew = message contained Hebrew script (restricted)
reason_alphabet_devanagari = message contained Devanagari script (restricted)

# Media filter — reason strings (used in the group notice and the log card)
reason_media_photo = photo posting is restricted
reason_media_video = video posting is restricted
reason_media_sticker = sticker posting is restricted
reason_media_gif = GIF/animation posting is restricted
reason_media_link = link posting is restricted

# Phase 7 — Ops & Health
# /health command strings
health_dm_only = ❌ This command can only be used in a private message with the bot.
health_cooldown = ⏳ Please wait { $seconds }s before using /health again.
settings_cooldown = ⏳ Please wait { $seconds }s before opening /settings again.
settings_edit_cooldown = ⏳ Please wait { $seconds }s before editing another setting.

# Group Commands (!star, !user, !adminlist)
usage_star = ⚠️ Usage: !star <@username|user_id> +[n]|-[n] or reply to a message with !star +[n]|-[n]
reply_star_updated = ⭐ { $target } ({ $change }) now has <b>{ $stars }</b> stars.
error_user_not_found = ❌ User not found.
user_info_card =
    👤 <b>User Information</b>

    • <b>Name:</b> { $name }
    • <b>User ID:</b> <code>{ $userId }</code>
    • <b>Username:</b> { $username }
    • <b>Warns:</b> { $warns }/{ $warnThreshold }
    • <b>Stars:</b> ⭐ { $stars }
adminlist_header = 🛡️ <b>Group Administrators</b>
adminlist_creator_label = 👑 <b>Creator:</b>
adminlist_admins_label = 👮 <b>Admins:</b>
adminlist_none = -

# Group Approval & Owner Group Management
group_approval_request =
    🔔 <b>Group Approval Request</b>

    The bot requires your approval to run in this group:
    • <b>Group:</b> { $title }
    • <b>Chat ID:</b> <code>{ $chatId }</code>
    • <b>Added by:</b> { $addedBy }

    Do you approve the bot to run in this group?
btn_approve_group = ✅ Approve
btn_reject_group = ❌ Reject
group_approval_approved =
    ✅ <b>Group Approved</b>

    • <b>Group:</b> { $title }
    • <b>Chat ID:</b> <code>{ $chatId }</code>
group_approval_rejected =
    ❌ <b>Group Rejected</b>

    • <b>Group:</b> { $title }
    • <b>Chat ID:</b> <code>{ $chatId }</code>

    The bot has said goodbye and left the group.
group_approval_pending = ⏳ This group's request to use the bot is pending and will be evaluated by the bot owner.
group_approved_notice = ✅ The request has been approved by the bot owner! Admins can now start configuring the bot with /settings.
group_rejected_goodbye = 👋 Goodbye! The bot owner does not approve this bot to run in this group. Leaving now.
activegroups_empty = 📋 There are currently no active approved groups.
activegroups_header = 📋 <b>Active Approved Groups ({ $count })</b>
usage_exitgroup = ⚠️ Usage: /exitgroup <chat_id> (e.g. /exitgroup -1001234567890)
exitgroup_success = ✅ Left group <b>{ $title }</b> (<code>{ $chatId }</code>) and removed it from active groups.
exitgroup_failed = ⚠️ Removed <code>{ $chatId }</code> from active groups, but failed to leave the chat on Telegram (the bot may have already left).
usage_bangroup = ⚠️ Usage: /bangroup <chat_id> (e.g. /bangroup -1001234567890)
bangroup_success = 🚫 Group <code>{ $chatId }</code> has been banned. The bot will automatically leave if invited.
usage_unbangroup = ⚠️ Usage: /unbangroup <chat_id> (e.g. /unbangroup -1001234567890)
unbangroup_success = ✅ Group <code>{ $chatId }</code> has been unbanned.
unbangroup_not_banned = ℹ️ Group <code>{ $chatId }</code> was not in the banned list.

# Inbox Group & Send Message
setinboxgroup_dm_only = ❌ This command can only be used in a DM with the bot. Send me a private message!
setinboxgroup_checking = ⏳ Checking your admin status across groups...
setinboxgroup_no_groups = You are not an admin of any active group this bot is currently in.
setinboxgroup_min_two_groups = ⚠️ You must be an admin in at least 2 active groups with the bot to configure an inbox group (one source group and one target inbox group).
setinboxgroup_select_source = Step 1: Select the source group whose member DMs should be forwarded:
setinboxgroup_select_target =
    Step 2: Select the target inbox group for <b>{ $group }</b> from the buttons below, or send the target group's <code>&lt;chat_id&gt;</code>:
setinboxgroup_btn_cancel = ❌ Cancel
setinboxgroup_cancelled = ❌ Operation cancelled.
setinboxgroup_same_group_error = ❌ Target inbox group cannot be the same as the source group.
setinboxgroup_cleared = ✅ Inbox group has been disabled for <b>{ $group }</b>.
unsetinboxgroup_none_configured = ℹ️ None of your groups currently have an inbox group configured.
unsetinboxgroup_select_group = Select the group whose inbox group you want to remove:
setinboxgroup_invalid_target = ❌ Invalid group selection or chat ID. Please run !setinboxgroup again.
setinboxgroup_not_target_admin = ❌ You must be an administrator in the target inbox group to link it.
setinboxgroup_bot_not_member = ❌ I am not a member (or cannot send messages) in that target group. Please add me to the target group first, then try !setinboxgroup again.
setinboxgroup_success = ✅ Inbox group for <b>{ $group }</b> has been set to <b>{ $inbox }</b> (<code>{ $inboxId }</code>).
setinboxgroup_target_confirm = 📥 This group is now configured as the inbox group for <b>{ $group }</b>. Reply to any relayed user message here to respond via the bot.

usage_sendmessage = ⚠️ Usage: !sendmessage <chat_id> <message> (or attach media / reply to a message in DM with !sendmessage <chat_id> [caption])
sendmessage_unauthorized = ❌ You are not authorized to send messages on behalf of the bot to group <code>{ $chatId }</code>.
sendmessage_success = ✅ Message sent to <b>{ $title }</b> (<code>{ $chatId }</code>).
sendmessage_failed = ❌ Failed to send message to <code>{ $chatId }</code>. Please check that the bot is in the group and has permission to send messages.

inbox_relay_header =
    📩 <b>Incoming User Message</b>
    • <b>From:</b> { $sender } (<code>{ $userId }</code>)
    • <b>Username:</b> { $username }
    • <b>Group:</b> { $group }
inbox_multi_group_note = ℹ️ <i>Note: This user is in multiple groups with the bot ({ $groups }).</i>
inbox_reply_sent = ✅ Reply sent to user.
inbox_reply_failed = ❌ Failed to deliver reply to the user (they may have blocked the bot).



