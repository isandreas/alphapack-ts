/**
 * Unified template placeholder replacement utility.
 *
 * Supported keys:
 *  {user_displayname} — clickable Telegram mention link (HTML)
 *  {user_id}          — numeric Telegram user ID
 *  {user_username}    — @username if set, otherwise first_name
 *  {group_name}       — group/chat title
 *  {bot_name}         — bot display name (env BOT_CUSTOM_NAME or first_name)
 *
 * Legacy aliases (kept for backwards compatibility):
 *  {mention}     → same as {user_displayname}
 *  {first_name}  → user first_name
 *  {username}    → same as {user_username}
 */
export function replacePlaceholders(
  template: string,
  options: {
    user?: { id: number; first_name: string; username?: string | null | undefined } | null | undefined;
    groupName?: string | null | undefined;
    botName?: string | null | undefined;
  },
): string {
  const escapeHtml = (str: string) =>
    str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let text = template;

  if (options.botName) {
    const safeBotName = escapeHtml(options.botName);
    text = text.replace(/{bot_name}/g, safeBotName);
  }

  if (options.groupName) {
    const safeGroupName = escapeHtml(options.groupName);
    text = text.replace(/{group_name}/g, safeGroupName);
  }

  if (options.user) {
    const u = options.user;
    const safeFirstName = escapeHtml(u.first_name);
    const userUsername = u.username ? `@${escapeHtml(u.username)}` : safeFirstName;
    const displayName = `<a href="tg://user?id=${u.id}">${safeFirstName}</a>`;

    text = text
      // New canonical keys
      .replace(/{user_displayname}/g, displayName)
      .replace(/{user_id}/g, String(u.id))
      .replace(/{user_username}/g, userUsername)
      // Legacy aliases
      .replace(/{mention}/g, displayName)
      .replace(/{first_name}/g, safeFirstName)
      .replace(/{username}/g, userUsername);
  }

  return text;
}

export interface ParsedButtonsText {
  text: string;
  inlineKeyboard?: Array<Array<{ text: string; url: string }>> | undefined;
}

/**
 * Parses bracketed buttons of the form `[ Button Label | Link ]` from a message.
 * Buttons on the same line are grouped into the same row in the inline keyboard.
 * Buttons on separate lines populate separate rows.
 * All parsed button syntax is removed from the resulting text message body.
 */
export function parseWelcomeButtons(text: string): ParsedButtonsText {
  const lines = text.split("\n");
  const finalLines: string[] = [];
  const keyboardRows: Array<Array<{ text: string; url: string }>> = [];

  const buttonRegex = /\[\s*([^|\]]+?)\s*\|\s*([^\s\]]+?)\s*\]/g;

  for (const line of lines) {
    let match;
    const row: Array<{ text: string; url: string }> = [];

    buttonRegex.lastIndex = 0;
    while ((match = buttonRegex.exec(line)) !== null) {
      const label = match[1].trim();
      const url = match[2].trim();
      row.push({ text: label, url });
    }

    if (row.length > 0) {
      keyboardRows.push(row);
      const cleanLine = line.replace(buttonRegex, "").trim();
      if (cleanLine.length > 0) {
        finalLines.push(cleanLine);
      }
    } else {
      finalLines.push(line);
    }
  }

  const cleanedText = finalLines.join("\n").trim();

  return {
    text: cleanedText,
    inlineKeyboard: keyboardRows.length > 0 ? keyboardRows : undefined,
  };
}

