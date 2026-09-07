import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { agent } from "@/db/schema";
import { checkLogin } from "@/lib/login";
import { createSessionToken, readSessionToken } from "@/lib/session";
import { parseSignup, registerAccount } from "@/lib/signup";
import { createVerificationToken } from "@/lib/verification";
import { makeTestDb, type TestDb } from "@/test/db";

import {
  createResetToken,
  findAgentForReset,
  readResetToken,
  ResetError,
  resetPassword,
} from "./password-reset";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
  process.env.SESSION_SECRET = "test-secret-at-least-16-chars";
});

const signup = {
  businessName: "Ploy's Salon",
  name: "Ploy",
  email: "ploy@example.com",
  password: "original-password",
};

async function seedAgent() {
  const { agentId } = await registerAccount(appDb, parseSignup(signup));
  return agentId;
}

describe("reset token", () => {
  it("round-trips the agent id and the epoch it was minted at", () => {
    expect(readResetToken(createResetToken("agent-1", 3))).toEqual({
      agentId: "agent-1",
      epoch: 3,
    });
  });

  it("is not interchangeable with a session or verification token", () => {
    const reset = createResetToken("agent-1", 0);
    expect(readSessionToken(reset)).toBeNull();
    // A verification token is not a reset token.
    expect(readResetToken(createVerificationToken("agent-1"))).toBeNull();
    // A session token is not a reset token.
    expect(readResetToken(createSessionToken("agent-1", 0))).toBeNull();
  });
});

describe("findAgentForReset", () => {
  it("finds by normalised email, returns null for a stranger", async () => {
    const id = await seedAgent();
    expect((await findAgentForReset(appDb, " PLOY@example.com "))?.id).toBe(id);
    expect(await findAgentForReset(appDb, "who@example.com")).toBeNull();
  });
});

describe("resetPassword", () => {
  it("sets the new password and invalidates existing sessions", async () => {
    const id = await seedAgent();

    // A session minted before the reset (epoch 0).
    const oldCookie = readSessionToken(createSessionToken(id, 0))!;
    expect(oldCookie.epoch).toBe(0);

    const result = await resetPassword(
      appDb,
      createResetToken(id, 0),
      "brand-new-password",
    );

    expect(result.agentId).toBe(id);
    expect(result.sessionEpoch).toBe(1); // bumped

    // Old password no longer works; new one does.
    expect(await checkLogin(appDb, signup.email, "original-password")).toEqual({
      status: "invalid",
    });
    const ok = await checkLogin(appDb, signup.email, "brand-new-password");
    expect(ok.status).toBe("unverified"); // password is right; email still unconfirmed

    // The pre-reset session's epoch (0) no longer matches the row (1).
    const [row] = await db
      .select({ e: agent.sessionEpoch })
      .from(agent)
      .where(eq(agent.id, id));
    expect(row.e).not.toBe(oldCookie.epoch);
  });

  it("rejects an invalid or expired token", async () => {
    await expect(
      resetPassword(appDb, "garbage.token", "brand-new-password"),
    ).rejects.toMatchObject({ name: "ResetError", code: "invalid_token" });
  });

  it("rejects a password under the minimum length", async () => {
    const id = await seedAgent();
    await expect(
      resetPassword(appDb, createResetToken(id, 0), "short"),
    ).rejects.toMatchObject({ name: "ResetError", code: "weak_password" });

    // ...and the password was not changed.
    expect(
      (await checkLogin(appDb, signup.email, "original-password")).status,
    ).toBe("unverified");
  });

  it("is single-use — a link can't be replayed after the reset it performed", async () => {
    const id = await seedAgent();
    const link = createResetToken(id, 0);

    await resetPassword(appDb, link, "first-new-password");
    // The same link again: the epoch has moved from 0 to 1.
    await expect(
      resetPassword(appDb, link, "second-new-password"),
    ).rejects.toMatchObject({ name: "ResetError", code: "invalid_token" });

    // The first reset's password still stands.
    expect(
      (await checkLogin(appDb, signup.email, "first-new-password")).status,
    ).toBe("unverified");
  });

  it("rejects a token whose agent no longer exists", async () => {
    const token = createResetToken("00000000-0000-0000-0000-000000000000", 0);
    await expect(
      resetPassword(appDb, token, "brand-new-password"),
    ).rejects.toBeInstanceOf(ResetError);
  });
});
