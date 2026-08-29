/**
 * types/settings.ts
 *
 * GroupSettings is the merged result of:
 *   Redis overrides (HGETALL groupSettingsKey(chatId))
 *   ← layered on top of →
 *   defaults.yaml
 *
 * This is the Phase 0 skeleton shape. Later phases add their own sub-objects
 * (moderation, antiSpam, welcome, etc.) without breaking the accessor contract.
 */

export interface GroupSettings {
  /** Locale for this group's bot replies. */
  locale: "id" | "en";

  // ── Phase 2+ fields (defined here so accessor type is stable) ────────────────
  /** Number of warns before the automatic action fires. */
  warnThreshold: number;
  /** Telegram channel ID to forward audit logs. null = disabled. */
  logChannelId: number | null;
  /** Feature toggle map — each key is a feature name, value is enabled bool. */
  features: Record<string, boolean>;

  /** Custom message template and toggle for automated/permanent bans. */
  banMessage: {
    enabled: boolean;
    template: string;
  };

  /** Custom message template and toggle for temporary bans. */
  tbanMessage: {
    enabled: boolean;
    template: string;
  };

  /** Anti-spam flood guard configuration. */
  floodGuard: {
    enabled: boolean;
    windowSeconds: number;
    messageThreshold: number;
    punishment: {
      type: "mute";
      durationSeconds: number;
    };
  };

  /** Welcome & captcha configuration. */
  welcome: {
    enabled: boolean;
    template: string;
    captcha: {
      enabled: boolean;
      timeoutSeconds: number;
    };
  };

  /** Goodbye notification configuration. */
  goodbye: {
    enabled: boolean;
    template: string;
  };

  /** Mentions & Relay configuration (Phase 4). */
  mentions: {
    adminRelay: {
      enabled: boolean;
      cooldownSeconds: number;
    };
    userNotify: {
      enabled: boolean;
      cooldownSeconds: number;
    };
  };

  /** Rules text configuration (Phase 5). */
  rules: {
    text: string | null;
  };

  /** Guide text configuration (Phase 5). */
  guide: {
    text: string | null;
  };

  /** Moderation command status gating (Phase 5). */
  moderation: {
    warn: { enabled: boolean };
    tban: { enabled: boolean };
    ban: { enabled: boolean };
    mute: { enabled: boolean };
  };

  /**
   * Alphabet / script filter (Phase 6).
   * Each boolean: true = "restricted" (messages containing that script trigger
   * a delete+kick). false (default) = the script is allowed, no action taken.
   * There is no master switch — every toggle is independent.
   */
  alphabetFilter: {
    cyrillic: boolean;
    arabic: boolean;
    /** Bundles Chinese Han, Hiragana/Katakana, and Hangul as one toggle. */
    cjk: boolean;
    thai: boolean;
    hebrew: boolean;
    devanagari: boolean;
  };

  /**
   * Media-type filter (Phase 6).
   * Each boolean: true = "restricted" (messages of that type trigger a
   * delete+kick). false (default) = the media type is allowed, no action taken.
   * "gif" maps to Telegram's message.animation (there is no separate gif type).
   * There is no master switch — every toggle is independent.
   */
  mediaFilter: {
    photo: boolean;
    video: boolean;
    sticker: boolean;
    /** Corresponds to message.animation in the Telegram Bot API. */
    gif: boolean;
    link: boolean;
  };
}
