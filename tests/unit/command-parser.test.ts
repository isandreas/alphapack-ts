import { describe, it, expect, vi } from "vitest";
import { commandParserMiddleware } from "../../src/middlewares/command-parser.js";
import type { BotContext } from "../../src/types/context.js";

function makeMessageCtx(overrides: {
  text?: string;
  caption?: string;
}): BotContext {
  const message: Record<string, unknown> = {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: -1001234567890, type: "supergroup", title: "Test Group" },
  };
  if (overrides.text !== undefined) {
    message.text = overrides.text;
  }
  if (overrides.caption !== undefined) {
    message.caption = overrides.caption;
  }
  return { message } as unknown as BotContext;
}

describe("commandParserMiddleware (Part F)", () => {
  it("normalizes !cmd with no arguments to /cmd and injects bot_command entity", async () => {
    const ctx = makeMessageCtx({ text: "!ping" });
    const next = vi.fn().mockResolvedValue(undefined);

    await commandParserMiddleware(ctx, next);

    expect(ctx.message?.text).toBe("/ping");
    expect(ctx.message?.entities).toEqual([
      { type: "bot_command", offset: 0, length: 5 },
    ]);
    expect(next).toHaveBeenCalledOnce();
  });

  it("normalizes !cmd with arguments and preserves extra whitespace", async () => {
    const ctx = makeMessageCtx({ text: "!warn   @baduser   spamming links" });
    const next = vi.fn().mockResolvedValue(undefined);

    await commandParserMiddleware(ctx, next);

    expect(ctx.message?.text).toBe("/warn   @baduser   spamming links");
    expect(ctx.message?.entities).toEqual([
      { type: "bot_command", offset: 0, length: 5 },
    ]);
    expect(next).toHaveBeenCalledOnce();
  });

  it("preserves mixed-case command names so downstream handlers can match", async () => {
    const ctx = makeMessageCtx({ text: "!SetLogChannel" });
    const next = vi.fn().mockResolvedValue(undefined);

    await commandParserMiddleware(ctx, next);

    expect(ctx.message?.text).toBe("/SetLogChannel");
    expect(ctx.message?.entities?.[0]?.length).toBe(14);
  });

  it("leaves standard /cmd messages untouched", async () => {
    const ctx = makeMessageCtx({ text: "/ban 123456 reason" });
    const next = vi.fn().mockResolvedValue(undefined);

    await commandParserMiddleware(ctx, next);

    expect(ctx.message?.text).toBe("/ban 123456 reason");
    expect(ctx.message?.entities).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("normalizes !cmd inside media captions and populates caption_entities", async () => {
    const ctx = makeMessageCtx({ caption: "!warn spammer photo" });
    const next = vi.fn().mockResolvedValue(undefined);

    await commandParserMiddleware(ctx, next);

    expect(ctx.message?.caption).toBe("/warn spammer photo");
    expect(ctx.message?.caption_entities).toEqual([
      { type: "bot_command", offset: 0, length: 5 },
    ]);
  });

  it("ignores malformed input: bare '!', whitespace after '!', or '!' mid-message", async () => {
    for (const raw of ["!", "!   ping", "hello !ping", "!!!", ""]) {
      const ctx = makeMessageCtx({ text: raw });
      const next = vi.fn().mockResolvedValue(undefined);

      await commandParserMiddleware(ctx, next);

      expect(ctx.message?.text).toBe(raw);
      expect(ctx.message?.entities).toBeUndefined();
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it("passes through updates that have no message object", async () => {
    const ctx = {} as unknown as BotContext;
    const next = vi.fn().mockResolvedValue(undefined);

    await commandParserMiddleware(ctx, next);

    expect(next).toHaveBeenCalledOnce();
  });
});

