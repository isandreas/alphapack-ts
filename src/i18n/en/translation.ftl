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
reply_flood_muted = 🔇 { $target } has been auto-muted for { $duration } for sending messages too quickly.

# Helpers
no_reason_provided = -
reason_warn_limit_reached = Automatically banned for reaching the warning limit.
error_generic = ❌ An error occurred.
btn_remove_warn = ➖ Remove Warning (-1)
warn_removed = ✅ Warning removed.
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
