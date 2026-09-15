import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { channel } from "@/db/schema";
import { makeAccount, makeTestDb, type TestDb } from "@/test/db";

import {
  isChannelEnabled,
  recordInboundSuccess,
  recordOutboundError,
  recordOutboundSuccess,
} from "./status";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
});

async function makeChannelRow(disabledAt: Date | null = null) {
  const accountId = await makeAccount(db);
  const [row] = await db
    .insert(channel)
    .values({ accountId, type: "line", name: "Test", config: {}, disabledAt })
    .returning({ id: channel.id });
  return row.id;
}

describe("isChannelEnabled", () => {
  it("is true when disabledAt is null, false otherwise", () => {
    expect(isChannelEnabled({ disabledAt: null })).toBe(true);
    expect(isChannelEnabled({ disabledAt: new Date() })).toBe(false);
  });
});

describe("recordInboundSuccess", () => {
  it("sets lastInboundAt", async () => {
    const channelId = await makeChannelRow();
    const before = Date.now();
    await recordInboundSuccess(appDb, channelId);

    const [row] = await db.select().from(channel).where(eq(channel.id, channelId));
    expect(row.lastInboundAt).toBeInstanceOf(Date);
    expect(row.lastInboundAt!.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("recordOutboundError / recordOutboundSuccess", () => {
  it("records an error, then a later success clears it", async () => {
    const channelId = await makeChannelRow();

    await recordOutboundError(appDb, channelId, "LINE push rejected (401)");
    let [row] = await db.select().from(channel).where(eq(channel.id, channelId));
    expect(row.lastError).toBe("LINE push rejected (401)");
    expect(row.lastErrorAt).toBeInstanceOf(Date);

    await recordOutboundSuccess(appDb, channelId);
    [row] = await db.select().from(channel).where(eq(channel.id, channelId));
    expect(row.lastError).toBeNull();
    expect(row.lastErrorAt).toBeNull();
  });

  it("recordInboundSuccess does not clear an outbound error", async () => {
    const channelId = await makeChannelRow();
    await recordOutboundError(appDb, channelId, "token expired");
    await recordInboundSuccess(appDb, channelId);

    const [row] = await db.select().from(channel).where(eq(channel.id, channelId));
    expect(row.lastError).toBe("token expired");
  });
});
