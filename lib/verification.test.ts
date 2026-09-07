import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";

import { agent } from "@/db/schema";
import { makeAccount, makeAgent, makeTestDb, type TestDb } from "@/test/db";

import { createSessionToken, readSessionToken } from "./session";
import {
  createVerificationToken,
  markEmailVerified,
  readVerificationToken,
} from "./verification";

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-at-least-16-chars";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("verification token", () => {
  it("round-trips the agent id", () => {
    const token = createVerificationToken("agent-1");
    expect(readVerificationToken(token)).toBe("agent-1");
  });

  it("rejects a tampered payload", () => {
    const token = createVerificationToken("agent-1");
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(
      JSON.stringify({ sub: "agent-9", prp: "email_verify", exp: 9999999999 }),
    ).toString("base64url")}.${sig}`;
    expect(readVerificationToken(forged)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = createVerificationToken("agent-1");
    process.env.SESSION_SECRET = "a-completely-different-secret-value";
    expect(readVerificationToken(token)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01"));
    const token = createVerificationToken("agent-1");
    vi.setSystemTime(new Date("2026-01-03")); // > 24h later
    expect(readVerificationToken(token)).toBeNull();
  });

  it("is not interchangeable with a session token (either direction)", () => {
    const verifyToken = createVerificationToken("agent-1");
    const sessionToken = createSessionToken("agent-1", 0);

    // A session cookie is not a valid verification link...
    expect(readVerificationToken(sessionToken)).toBeNull();
    // ...and a verification link is not a valid session.
    expect(readSessionToken(verifyToken)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(readVerificationToken(undefined)).toBeNull();
  });
});

describe("markEmailVerified", () => {
  let db: TestDb;
  let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

  beforeEach(async () => {
    ({ db, appDb } = await makeTestDb());
  });

  it("sets the timestamp and is idempotent", async () => {
    const accountId = await makeAccount(db);
    const { id } = await makeAgent(db, accountId);

    // makeAgent doesn't set it — starts unverified.
    const [before] = await db
      .select({ v: agent.emailVerifiedAt })
      .from(agent)
      .where(eq(agent.id, id));
    expect(before.v).toBeNull();

    expect(await markEmailVerified(appDb, id)).toBe(true);
    const [after] = await db
      .select({ v: agent.emailVerifiedAt })
      .from(agent)
      .where(eq(agent.id, id));
    expect(after.v).toBeInstanceOf(Date);

    // Second click: still fine, still true.
    expect(await markEmailVerified(appDb, id)).toBe(true);
  });

  it("returns false for an unknown agent id", async () => {
    expect(
      await markEmailVerified(appDb, "00000000-0000-0000-0000-000000000000"),
    ).toBe(false);
  });
});
