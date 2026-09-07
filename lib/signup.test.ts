import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { account, agent } from "@/db/schema";
import { verifyPassword } from "@/lib/password";
import { makeTestDb, type TestDb } from "@/test/db";

import {
  findUnverifiedAgent,
  parseSignup,
  registerAccount,
  SignupError,
} from "./signup";
import { markEmailVerified } from "./verification";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
});

const good = {
  businessName: "Nok's Coffee",
  name: "Nok",
  email: "  NOK@Example.com ",
  password: "hunter2hunter2",
};

describe("parseSignup", () => {
  it("normalises the email and trims names", () => {
    const parsed = parseSignup(good);
    expect(parsed.email).toBe("nok@example.com");
    expect(parsed.businessName).toBe("Nok's Coffee");
  });

  it("rejects missing fields", () => {
    expect(() => parseSignup({ ...good, businessName: "" })).toThrow(SignupError);
    expect(() => parseSignup({ ...good, name: "  " })).toThrow(/required/);
  });

  it("rejects a malformed email", () => {
    expect(() => parseSignup({ ...good, email: "not-an-email" })).toThrow(
      /valid email/,
    );
  });

  it("rejects a short password", () => {
    try {
      parseSignup({ ...good, password: "short" });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SignupError);
      expect((error as SignupError).code).toBe("weak_password");
    }
  });
});

describe("registerAccount", () => {
  it("creates the account and an unverified owner agent", async () => {
    const { accountId, agentId } = await registerAccount(
      appDb,
      parseSignup(good),
    );

    const [acct] = await db
      .select()
      .from(account)
      .where(eq(account.id, accountId));
    expect(acct.name).toBe("Nok's Coffee");

    const [row] = await db.select().from(agent).where(eq(agent.id, agentId));
    expect(row.email).toBe("nok@example.com");
    expect(row.role).toBe("owner");
    expect(row.emailVerifiedAt).toBeNull();
    expect(await verifyPassword("hunter2hunter2", row.passwordHash)).toBe(true);
  });

  it("rejects a duplicate email with SignupError('email_taken')", async () => {
    await registerAccount(appDb, parseSignup(good));

    await expect(
      registerAccount(appDb, parseSignup({ ...good, businessName: "Other" })),
    ).rejects.toMatchObject({ name: "SignupError", code: "email_taken" });

    // No orphan second account.
    expect(await db.select().from(account)).toHaveLength(1);
  });
});

describe("findUnverifiedAgent", () => {
  it("finds an agent who has not verified, by normalised email", async () => {
    const { agentId } = await registerAccount(appDb, parseSignup(good));
    const found = await findUnverifiedAgent(appDb, "NOK@example.com ");
    expect(found?.id).toBe(agentId);
  });

  it("returns null once the agent has verified (no probing)", async () => {
    const { agentId } = await registerAccount(appDb, parseSignup(good));
    await markEmailVerified(appDb, agentId);
    expect(await findUnverifiedAgent(appDb, good.email)).toBeNull();
  });

  it("returns null for an unknown address", async () => {
    expect(await findUnverifiedAgent(appDb, "nobody@example.com")).toBeNull();
  });
});
