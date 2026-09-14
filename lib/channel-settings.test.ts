import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { channel } from "@/db/schema";
import { resolveChannelConfig } from "@/lib/channels/config";
import { getAdapter } from "@/lib/channels/registry";
import { makeAccount, makeTestDb, type TestDb } from "@/test/db";

import { connectLineChannel, listChannels } from "./channel-settings";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
  process.env.CHANNEL_CREDENTIALS_KEY = randomBytes(32).toString("hex");
});

const lineInput = {
  name: "LINE — Bakery",
  channelSecret: "line-channel-secret",
  channelAccessToken: "line-access-token",
};

describe("connectLineChannel", () => {
  it("an owner can connect a LINE channel with credentials encrypted at rest", async () => {
    const accountId = await makeAccount(db);
    const { channelId } = await connectLineChannel(
      appDb,
      { accountId, role: "owner" },
      lineInput,
    );

    const [row] = await db.select().from(channel).where(eq(channel.id, channelId));
    expect(row.accountId).toBe(accountId);
    expect(row.type).toBe("line");
    expect(row.name).toBe("LINE — Bakery");
    expect(row.config).toEqual({});

    // Nothing readable in plaintext anywhere on the row.
    expect(row.credentialsEncrypted).not.toBeNull();
    expect(row.credentialsEncrypted).not.toContain("line-channel-secret");
    expect(row.credentialsEncrypted).not.toContain("line-access-token");
    expect(JSON.stringify(row)).not.toContain("line-channel-secret");

    // ...but the real pipeline can still reconstruct it: this is exactly
    // what the LINE adapter/verifier receive at runtime.
    expect(resolveChannelConfig(row)).toEqual({
      channelSecret: "line-channel-secret",
      channelAccessToken: "line-access-token",
    });
  });

  it("the adapter can actually send with the round-tripped credentials", async () => {
    const accountId = await makeAccount(db);
    const { channelId } = await connectLineChannel(
      appDb,
      { accountId, role: "owner" },
      lineInput,
    );
    const [row] = await db.select().from(channel).where(eq(channel.id, channelId));
    const config = resolveChannelConfig(row);

    const fetchMock = vi.fn(
      async (_url: string, init: RequestInit): Promise<Response> => {
        expect((init.headers as Record<string, string>).authorization).toBe(
          "Bearer line-access-token",
        );
        return new Response("{}", { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = getAdapter("line");
    await adapter.sendOutbound(
      { body: "hi", attachments: [], thread: { platformId: "U1" } },
      config,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("rejects a non-owner and creates nothing", async () => {
    const accountId = await makeAccount(db);
    await expect(
      connectLineChannel(appDb, { accountId, role: "agent" }, lineInput),
    ).rejects.toMatchObject({ name: "ChannelSettingsError", code: "not_owner" });
    expect(await db.select().from(channel)).toHaveLength(0);
  });

  it("rejects missing fields", async () => {
    const accountId = await makeAccount(db);
    await expect(
      connectLineChannel(appDb, { accountId, role: "owner" }, { ...lineInput, channelSecret: "  " }),
    ).rejects.toMatchObject({ code: "missing_fields" });
  });
});

describe("listChannels", () => {
  it("lists an account's channels, newest first, scoped to the account", async () => {
    const accountA = await makeAccount(db);
    const accountB = await makeAccount(db);
    await connectLineChannel(appDb, { accountId: accountA, role: "owner" }, lineInput);
    await new Promise((r) => setTimeout(r, 5));
    await connectLineChannel(
      appDb,
      { accountId: accountA, role: "owner" },
      { ...lineInput, name: "LINE — Second" },
    );
    await connectLineChannel(
      appDb,
      { accountId: accountB, role: "owner" },
      { ...lineInput, name: "Other account's LINE" },
    );

    const listA = await listChannels(appDb, accountA);
    expect(listA.map((c) => c.name)).toEqual(["LINE — Second", "LINE — Bakery"]);
    expect(listA.every((c) => c.type === "line")).toBe(true);

    const listB = await listChannels(appDb, accountB);
    expect(listB.map((c) => c.name)).toEqual(["Other account's LINE"]);
  });

  it("never returns credential fields", async () => {
    const accountId = await makeAccount(db);
    await connectLineChannel(appDb, { accountId, role: "owner" }, lineInput);
    const [summary] = await listChannels(appDb, accountId);
    expect(summary).not.toHaveProperty("credentialsEncrypted");
    expect(summary).not.toHaveProperty("config");
    expect(JSON.stringify(summary)).not.toContain("line-channel-secret");
  });
});
