import { beforeEach, describe, expect, it } from "vitest";

import { makeAccount, makeAgent, makeChannel, makeTestDb, type TestDb } from "@/test/db";

import { getOnboardingStatus } from "./onboarding";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
});

describe("getOnboardingStatus", () => {
  it("is incomplete for a brand-new account (owner only, no channels)", async () => {
    const accountId = await makeAccount(db);
    await makeAgent(db, accountId, { role: "owner" });

    const status = await getOnboardingStatus(appDb, accountId);

    expect(status).toEqual({
      channelConnected: false,
      teammateInvited: false,
      complete: false,
    });
  });

  it("counts a connected channel even if no teammate has joined yet", async () => {
    const accountId = await makeAccount(db);
    await makeChannel(db, accountId, { type: "line" });

    const status = await getOnboardingStatus(appDb, accountId);

    expect(status.channelConnected).toBe(true);
    expect(status.teammateInvited).toBe(false);
    expect(status.complete).toBe(false);
  });

  it("counts a still-pending invite as a teammate, not just an accepted one", async () => {
    const accountId = await makeAccount(db);
    await makeAgent(db, accountId, { role: "agent", emailVerifiedAt: null });

    const status = await getOnboardingStatus(appDb, accountId);

    expect(status.teammateInvited).toBe(true);
  });

  it("is complete once both a channel exists and a non-owner agent exists", async () => {
    const accountId = await makeAccount(db);
    await makeChannel(db, accountId, { type: "line" });
    await makeAgent(db, accountId, { role: "agent" });

    const status = await getOnboardingStatus(appDb, accountId);

    expect(status).toEqual({
      channelConnected: true,
      teammateInvited: true,
      complete: true,
    });
  });

  it("scopes to the account — another account's channel/teammate don't count", async () => {
    const accountId = await makeAccount(db);
    const otherAccountId = await makeAccount(db);
    await makeChannel(db, otherAccountId, { type: "line" });
    await makeAgent(db, otherAccountId, { role: "agent" });

    const status = await getOnboardingStatus(appDb, accountId);

    expect(status.complete).toBe(false);
  });
});
