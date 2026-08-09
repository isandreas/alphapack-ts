/**
 * Builds a t.me deep-link URL.
 *
 * Examples:
 *   deepLink("alphapack_bot")           → "https://t.me/alphapack_bot"
 *   deepLink("alphapack_bot", "start")  → "https://t.me/alphapack_bot?start=start"
 *   deepLinkGroup(-1001234567890)       → "https://t.me/c/1234567890"
 */
export function deepLink(botUsername: string, startPayload?: string): string {
  const base = `https://t.me/${botUsername}`;
  return startPayload ? `${base}?start=${encodeURIComponent(startPayload)}` : base;
}

/**
 * Builds a t.me link to a specific message in a public group by its username.
 */
export function messageLink(groupUsername: string, messageId: number): string {
  return `https://t.me/${groupUsername}/${messageId}`;
}

/**
 * Builds a t.me link to a private supergroup/channel using its numeric ID.
 * Strips the leading -100 prefix required by Telegram.
 */
export function privateGroupMessageLink(
  chatId: number,
  messageId: number,
): string {
  const id = chatId.toString().replace(/^-100/, "");
  return `https://t.me/c/${id}/${messageId}`;
}
