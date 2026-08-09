/**
 * Parses human-readable duration strings into seconds.
 *
 * Supported units:
 *   s  → seconds
 *   m  → minutes
 *   h  → hours
 *   d  → days
 *   w  → weeks
 *
 * Examples:
 *   "30s"  → 30
 *   "10m"  → 600
 *   "2h"   → 7200
 *   "1d"   → 86400
 *   "1w"   → 604800
 *
 * Returns null if the string is invalid.
 */
export function parseDuration(input: string): number | null {
  const match = /^(\d+)\s*(s|m|h|d|w)$/i.exec(input.trim());
  if (!match) return null;

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();

  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3_600,
    d: 86_400,
    w: 604_800,
  };

  return value * (multipliers[unit] ?? 1);
}

/**
 * Formats a duration in seconds into a human-readable string.
 * Used for ban/mute action cards.
 *
 * Examples:
 *   3661 → "1h 1m 1s"
 *   86400 → "1d"
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";

  const parts: string[] = [];
  const intervals: [string, number][] = [
    ["w", 604_800],
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
    ["s", 1],
  ];

  let remaining = seconds;
  for (const [unit, div] of intervals) {
    const count = Math.floor(remaining / div);
    if (count > 0) {
      parts.push(`${count}${unit}`);
      remaining -= count * div;
    }
  }

  return parts.join(" ");
}

/**
 * Returns a Unix timestamp (seconds) for "now + durationSeconds".
 * Useful when constructing Telegram restrictUntilDate values.
 */
export function untilDate(durationSeconds: number): number {
  return Math.floor(Date.now() / 1_000) + durationSeconds;
}
