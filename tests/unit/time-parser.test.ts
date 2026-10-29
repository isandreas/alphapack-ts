import { describe, it, expect } from "vitest";
import { parseDuration, formatDuration } from "../../src/utils/time-parser.js";

describe("time-parser (Part F)", () => {
  it("parses valid duration strings (s, m, h, d, w)", () => {
    expect(parseDuration("30s")).toBe(30);
    expect(parseDuration("10m")).toBe(600);
    expect(parseDuration("2h")).toBe(7_200);
    expect(parseDuration("1d")).toBe(86_400);
    expect(parseDuration("1w")).toBe(604_800);
    expect(parseDuration("  15M  ")).toBe(900);
  });

  it("rejects garbage input, negative numbers, and zero", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("garbage")).toBeNull();
    expect(parseDuration("10y")).toBeNull();
    expect(parseDuration("123")).toBeNull();
    expect(parseDuration("-10m")).toBeNull();
    expect(parseDuration("-1d")).toBeNull();
    expect(parseDuration("0s")).toBeNull();
    expect(parseDuration("0m")).toBeNull();
    expect(parseDuration("0h")).toBeNull();
    expect(parseDuration("0d")).toBeNull();
  });

  it("formats seconds back into human-readable durations", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(-5)).toBe("0s");
    expect(formatDuration(600)).toBe("10m");
    expect(formatDuration(3_661)).toBe("1h 1m 1s");
    expect(formatDuration(86_400)).toBe("1d");
  });
});

