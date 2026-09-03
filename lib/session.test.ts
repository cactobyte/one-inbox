import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionToken, readSessionToken } from "./session";

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-at-least-16-chars";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("session tokens", () => {
  it("round-trips the agent id", () => {
    const token = createSessionToken("agent-123");
    expect(readSessionToken(token)).toBe("agent-123");
  });

  it("rejects a tampered payload", () => {
    const token = createSessionToken("agent-123");
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(
      JSON.stringify({ sub: "agent-999", exp: 9999999999 }),
    ).toString("base64url")}.${sig}`;
    expect(readSessionToken(forged)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = createSessionToken("agent-123");
    process.env.SESSION_SECRET = "a-completely-different-secret";
    expect(readSessionToken(token)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01"));
    const token = createSessionToken("agent-123");
    vi.setSystemTime(new Date("2020-02-01"));
    expect(readSessionToken(token)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(readSessionToken(undefined)).toBeNull();
  });
});
