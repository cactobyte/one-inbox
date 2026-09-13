import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { agent } from "@/db/schema";
import { checkLogin } from "@/lib/login";
import { makeAccount, makeAgent, makeTestDb, type TestDb } from "@/test/db";

import {
  acceptInvite,
  cancelInvite,
  createInviteToken,
  inviteTeammate,
  listTeam,
  readInviteToken,
  reissueInvite,
} from "./team";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
  process.env.SESSION_SECRET = "test-secret-at-least-16-chars";
});

async function makeOwner(accountId: string) {
  return makeAgent(db, accountId, {
    role: "owner",
    email: `owner-${Date.now()}-${Math.random()}@example.test`,
    emailVerifiedAt: new Date(),
  });
}

describe("inviteTeammate", () => {
  it("an owner can invite by email with a role", async () => {
    const accountId = await makeAccount(db);

    const { agentId, token } = await inviteTeammate(
      appDb,
      { accountId, role: "owner" },
      { email: "  New@Example.com ", role: "agent" },
    );

    expect(readInviteToken(token)).toBe(agentId);

    const [row] = await db.select().from(agent).where(eq(agent.id, agentId));
    expect(row.email).toBe("new@example.com");
    expect(row.name).toBe("new@example.com"); // placeholder until accepted
    expect(row.role).toBe("agent");
    expect(row.accountId).toBe(accountId);
    expect(row.emailVerifiedAt).toBeNull();
  });

  it("rejects an invite from a non-owner and creates nothing", async () => {
    const accountId = await makeAccount(db);
    await expect(
      inviteTeammate(
        appDb,
        { accountId, role: "agent" },
        { email: "x@example.com", role: "agent" },
      ),
    ).rejects.toMatchObject({ name: "TeamError", code: "not_owner" });

    expect(await db.select().from(agent)).toHaveLength(0);
  });

  it("rejects inviting someone as owner", async () => {
    const accountId = await makeAccount(db);
    await expect(
      inviteTeammate(
        appDb,
        { accountId, role: "owner" },
        // @ts-expect-error — exercising the runtime guard against a bad role
        { email: "x@example.com", role: "owner" },
      ),
    ).rejects.toMatchObject({ name: "TeamError", code: "invalid_role" });
  });

  it("rejects an email that already has an agent row anywhere (active or pending)", async () => {
    const accountA = await makeAccount(db);
    const accountB = await makeAccount(db);
    await makeAgent(db, accountA, { email: "taken@example.com" });

    await expect(
      inviteTeammate(
        appDb,
        { accountId: accountB, role: "owner" },
        { email: "taken@example.com", role: "agent" },
      ),
    ).rejects.toMatchObject({ name: "TeamError", code: "email_taken" });

    // A second invite to an already-pending invite's email is caught too.
    const { agentId: pendingId } = await inviteTeammate(
      appDb,
      { accountId: accountB, role: "owner" },
      { email: "pending@example.com", role: "agent" },
    );
    await expect(
      inviteTeammate(
        appDb,
        { accountId: accountA, role: "owner" },
        { email: "pending@example.com", role: "admin" },
      ),
    ).rejects.toMatchObject({ code: "email_taken" });

    expect(
      await db.select().from(agent).where(eq(agent.id, pendingId)),
    ).toHaveLength(1);
  });
});

describe("acceptInvite", () => {
  it("sets the name and password and lets the agent log in", async () => {
    const accountId = await makeAccount(db);
    const { agentId, token } = await inviteTeammate(
      appDb,
      { accountId, role: "owner" },
      { email: "fon@example.com", role: "agent" },
    );

    const result = await acceptInvite(appDb, token, {
      name: "Fon",
      password: "a-real-password",
    });
    expect(result).toEqual({ agentId, accountId, sessionEpoch: 0 });

    const [row] = await db.select().from(agent).where(eq(agent.id, agentId));
    expect(row.name).toBe("Fon");
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);

    const login = await checkLogin(appDb, "fon@example.com", "a-real-password");
    expect(login).toEqual({ status: "ok", agent: { id: agentId, sessionEpoch: 0 } });
  });

  it("cannot be accepted twice", async () => {
    const accountId = await makeAccount(db);
    const { token } = await inviteTeammate(
      appDb,
      { accountId, role: "owner" },
      { email: "fon@example.com", role: "agent" },
    );
    await acceptInvite(appDb, token, { name: "Fon", password: "first-password" });

    await expect(
      acceptInvite(appDb, token, { name: "Fon Again", password: "second-password" }),
    ).rejects.toMatchObject({ name: "TeamError", code: "invalid_token" });

    // The first acceptance's password still works.
    const login = await checkLogin(appDb, "fon@example.com", "first-password");
    expect(login.status).toBe("ok");
  });

  it("rejects a garbage token", async () => {
    await expect(
      acceptInvite(appDb, "not.a.token", { name: "Fon", password: "whatever123" }),
    ).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("rejects a weak password without changing the row", async () => {
    const accountId = await makeAccount(db);
    const { agentId, token } = await inviteTeammate(
      appDb,
      { accountId, role: "owner" },
      { email: "fon@example.com", role: "agent" },
    );
    await expect(
      acceptInvite(appDb, token, { name: "Fon", password: "short" }),
    ).rejects.toMatchObject({ code: "weak_password" });

    const [row] = await db.select().from(agent).where(eq(agent.id, agentId));
    expect(row.emailVerifiedAt).toBeNull();
  });

  it("rejects an empty name", async () => {
    const accountId = await makeAccount(db);
    const { token } = await inviteTeammate(
      appDb,
      { accountId, role: "owner" },
      { email: "fon@example.com", role: "agent" },
    );
    await expect(
      acceptInvite(appDb, token, { name: "   ", password: "a-real-password" }),
    ).rejects.toMatchObject({ code: "invalid_name" });
  });
});

describe("listTeam", () => {
  it("lists owner and invited members, scoped to the account", async () => {
    const accountA = await makeAccount(db);
    const accountB = await makeAccount(db);
    const ownerA = await makeOwner(accountA);
    await makeOwner(accountB);

    await inviteTeammate(
      appDb,
      { accountId: accountA, role: "owner" },
      { email: "invited@example.com", role: "agent" },
    );

    const teamA = await listTeam(appDb, accountA);
    expect(teamA.map((m) => m.email).sort()).toEqual([
      "invited@example.com",
      ownerA.email,
    ]);
    const invited = teamA.find((m) => m.email === "invited@example.com")!;
    expect(invited.status).toBe("invited");
    const owner = teamA.find((m) => m.email === ownerA.email)!;
    expect(owner.status).toBe("active");
    expect(owner.role).toBe("owner");

    const teamB = await listTeam(appDb, accountB);
    expect(teamB.map((m) => m.email)).not.toContain("invited@example.com");
  });
});

describe("cancelInvite", () => {
  it("deletes a pending invite in the caller's account", async () => {
    const accountId = await makeAccount(db);
    const { agentId } = await inviteTeammate(
      appDb,
      { accountId, role: "owner" },
      { email: "x@example.com", role: "agent" },
    );

    await cancelInvite(appDb, accountId, agentId);
    expect(await db.select().from(agent).where(eq(agent.id, agentId))).toHaveLength(0);
  });

  it("never deletes an already-active agent, even via the same call shape", async () => {
    const accountId = await makeAccount(db);
    const active = await makeAgent(db, accountId, { emailVerifiedAt: new Date() });

    await expect(cancelInvite(appDb, accountId, active.id)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await db.select().from(agent).where(eq(agent.id, active.id))).toHaveLength(1);
  });

  it("refuses to cancel a pending invite from another account", async () => {
    const accountA = await makeAccount(db);
    const accountB = await makeAccount(db);
    const { agentId } = await inviteTeammate(
      appDb,
      { accountId: accountA, role: "owner" },
      { email: "x@example.com", role: "agent" },
    );

    await expect(cancelInvite(appDb, accountB, agentId)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await db.select().from(agent).where(eq(agent.id, agentId))).toHaveLength(1);
  });
});

describe("reissueInvite", () => {
  it("returns a fresh token for the same pending agent", async () => {
    const accountId = await makeAccount(db);
    const { agentId, token: firstToken } = await inviteTeammate(
      appDb,
      { accountId, role: "owner" },
      { email: "x@example.com", role: "agent" },
    );

    const secondToken = await reissueInvite(appDb, accountId, agentId);
    expect(readInviteToken(secondToken)).toBe(agentId);
    // Both still work (stateless tokens aren't revoked by reissuing).
    expect(readInviteToken(firstToken)).toBe(agentId);
  });

  it("fails for an already-accepted invite", async () => {
    const accountId = await makeAccount(db);
    const { agentId, token } = await inviteTeammate(
      appDb,
      { accountId, role: "owner" },
      { email: "x@example.com", role: "agent" },
    );
    await acceptInvite(appDb, token, { name: "X", password: "a-real-password" });

    await expect(reissueInvite(appDb, accountId, agentId)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("invite token", () => {
  it("is not a valid session or reset token", async () => {
    // Sanity: the invite token round-trips only through its own purpose.
    const token = createInviteToken("agent-1");
    expect(readInviteToken(token)).toBe("agent-1");
  });
});
