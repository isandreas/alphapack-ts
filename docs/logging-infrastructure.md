Context: Phases 0 and 1 are complete and verified. Build directly on top of them —
reuse the existing getGroupSettings pattern, Redis key conventions, and admin-guard.
Do not touch anti-spam, flood protection, welcome messages, or /settings menu — none
of that is in scope here. Long polling only, no webhook.

Implement a standalone logging infrastructure pass: a DM-based `!setlogchannel` flow
so admins can configure their group's log channel themselves, plus retrofitting
Phase 1's warn/tban/ban to log correctly-formatted cards to it. This is a small,
deliberately-scoped preview of what will later live inside Phase 5's full /settings
menu, but must work standalone now.

## Part A — Track which groups the bot is in (new — required for group selection)
- Add a lightweight group registry: on every `my_chat_member` update where the bot's
  own status changes, and/or opportunistically on any message seen in a group, upsert
  `{chatId, chatTitle}` into a Redis set/hash of known groups (e.g. a hash
  `bot:known_groups` mapping chatId → chatTitle). Remove the entry when the bot is
  kicked/leaves (status becomes 'left' or 'kicked' in the my_chat_member update).
- This registry is what lets `!setlogchannel` list "groups this bot is in" without
  guessing — Phase 0/1 didn't need this, so add it now as a small standalone piece
  (e.g. `features/settings/group-registry.ts`).

## Part B — `!setlogchannel` conversation (DM only)
Implement as a grammY conversation (`@grammyjs/conversations`), DM-only (reply with an
i18n error if run in a group):

1. Look up every group from the registry (Part A) where this user is a verified
   admin. Verification: reuse Phase 0's `isGroupAdmin` check (fresh check, don't
   trust a stale cache for this security-sensitive flow) against each candidate group.
2. If the resulting list is empty: reply explaining the user isn't an admin of any
   group the bot is currently in, and end the conversation.
3. Otherwise present an inline keyboard listing group titles (one per row is fine),
   callback data carrying the chatId. Wait for selection.
4. After a group is selected, prompt: "Forward any message from the channel you want
   to use as the log channel for **{group title}**."
5. Wait for the next message from the admin. It must be a forwarded message whose
   origin is a channel (`forward_origin.type === 'channel'`, or the older
   `forward_from_chat.type === 'channel'` field depending on grammY/Bot API version
   in use — support whichever your grammY version exposes). If the message isn't a
   forward from a channel, reply with a clear usage error and re-prompt (don't just
   abandon the conversation on the first mistake — allow a retry).
6. Extract the channel's chat id from the forwarded message. Call `getChatMember` for
   the bot's own id against that channel id:
   - If the bot is not a member, or is a member but not an administrator with
     `can_post_messages` permission: reject with a clear error telling the admin to
     add the bot as an admin with "Post Messages" permission in that channel, then
     retry `!setlogchannel`. Do NOT save anything in this case.
   - If verified: save `logChannelId` onto that group's settings (Redis, via a new
     `setGroupSetting(chatId, 'logChannelId', channelId)` writer — group-settings
     currently only supports reads via `getGroupSettings`, per Phase 0's stub; add
     the writer now, following the same Redis-override-over-yaml-defaults pattern).
7. Confirm success in the DM, and post a short confirmation message to the newly
   configured log channel itself (e.g. "✅ This channel is now the log channel for
   {group title}.") so the admin gets immediate visual confirmation it actually works.

## Part C — `postLogCard` helper
- Centralized helper in `middlewares/logger.ts`: `postLogCard(chatId, cardData)`.
- Resolution: `getGroupSettings(chatId).logChannelId` — if not set, skip silently (no
  error). There is no global/env fallback; if a group hasn't run `!setlogchannel`, it
  simply has no logging, and that's expected/acceptable.
- Card format — match this exactly (see Part D for field-by-field detail):