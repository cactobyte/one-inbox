import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionToken, readSessionToken } from "./session";

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-at-least-16-chars";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("session tokens", () => {
  it("round-trips the agent id and epoch", () => {
    const token = createSessionToken("agent-123", 7);
    expect(readSessionToken(token)).toEqual({ agentId: "agent-123", epoch: 7 });
  });

  it("rejects a tampered payload", () => {
    const token = createSessionToken("agent-123", 0);
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(
      JSON.stringify({ sub: "agent-999", epc: 0, exp: 9999999999 }),
    ).toString("base64url")}.${sig}`;
    expect(readSessionToken(forged)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = createSessionToken("agent-123", 0);
    process.env.SESSION_SECRET = "a-completely-different-secret";
    expect(readSessionToken(token)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01"));
    const token = createSessionToken("agent-123", 0);
    vi.setSystemTime(new Date("2020-02-01"));
    expect(readSessionToken(token)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(readSessionToken(undefined)).toBeNull();
  });

  it("defaults a legacy token with no epoch claim to epoch 0", () => {
    // A cookie minted before session_epoch existed: valid signature, no `epc`.
    const secret = process.env.SESSION_SECRET!;
    const payload = Buffer.from(
      JSON.stringify({ sub: "agent-legacy", exp: 9999999999 }),
    ).toString("base64url");
    const sig = createHmac("sha256", secret).update(payload).digest("base64url");
    expect(readSessionToken(`${payload}.${sig}`)).toEqual({
      agentId: "agent-legacy",
      epoch: 0,
    });
  });
});
