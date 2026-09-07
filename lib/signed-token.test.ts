import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSignedToken, readSignedToken } from "./signed-token";

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-at-least-16-chars";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("signed-token", () => {
  it("round-trips the subject for the matching purpose", () => {
    const token = createSignedToken("purpose_a", "agent-1", 3600);
    expect(readSignedToken("purpose_a", token)).toBe("agent-1");
  });

  it("rejects a token read with the wrong purpose", () => {
    const token = createSignedToken("purpose_a", "agent-1", 3600);
    expect(readSignedToken("purpose_b", token)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = createSignedToken("p", "agent-1", 3600);
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(
      JSON.stringify({ sub: "agent-9", prp: "p", exp: 9999999999 }),
    ).toString("base64url")}.${sig}`;
    expect(readSignedToken("p", forged)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = createSignedToken("p", "agent-1", 3600);
    process.env.SESSION_SECRET = "an-entirely-different-secret";
    expect(readSignedToken("p", token)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = createSignedToken("p", "agent-1", 60);
    vi.setSystemTime(new Date("2026-01-01T00:02:00Z"));
    expect(readSignedToken("p", token)).toBeNull();
  });

  it("returns null for undefined / malformed input", () => {
    expect(readSignedToken("p", undefined)).toBeNull();
    expect(readSignedToken("p", "not-a-token")).toBeNull();
  });
});
