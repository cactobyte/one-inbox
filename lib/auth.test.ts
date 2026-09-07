import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { agent } from "@/db/schema";
import { makeAccount, makeAgent, makeTestDb, type TestDb } from "@/test/db";

import { bumpSessionEpoch } from "./auth";
import { createSessionToken, readSessionToken } from "./session";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
  process.env.SESSION_SECRET = "test-secret-at-least-16-chars";
});

describe("bumpSessionEpoch", () => {
  it("advances the agent's epoch and returns the new value", async () => {
    const accountId = await makeAccount(db);
    const { id } = await makeAgent(db, accountId);

    const [before] = await db
      .select({ e: agent.sessionEpoch })
      .from(agent)
      .where(eq(agent.id, id));
    expect(before.e).toBe(0);

    expect(await bumpSessionEpoch(appDb, id)).toBe(1);
    expect(await bumpSessionEpoch(appDb, id)).toBe(2);

    const [after] = await db
      .select({ e: agent.sessionEpoch })
      .from(agent)
      .where(eq(agent.id, id));
    expect(after.e).toBe(2);
  });

  it("a cookie minted before the bump no longer matches the row", async () => {
    const accountId = await makeAccount(db);
    const { id } = await makeAgent(db, accountId);

    // Cookie issued at login, epoch 0.
    const claims = readSessionToken(createSessionToken(id, 0))!;
    expect(claims.epoch).toBe(0);

    const newEpoch = await bumpSessionEpoch(appDb, id);

    // getCurrentAgent's check: row.sessionEpoch !== claims.epoch → rejected.
    expect(newEpoch).not.toBe(claims.epoch);

    // A cookie re-minted after the bump matches again.
    const fresh = readSessionToken(createSessionToken(id, newEpoch))!;
    expect(fresh.epoch).toBe(newEpoch);
  });
});
