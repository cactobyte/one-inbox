import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { message } from "@/db/schema";
import {
  makeAccount,
  makeAgent,
  makeChannel,
  makeTestDb,
  type TestDb,
} from "@/test/db";

import { listBroadcastTargets, sendBroadcast } from "./broadcast";
import { ValidationError } from "./inbox/errors";
import { ingestInbound } from "./inbox/ingest";

/**
 * Broadcast (M13) is many `sendReply` calls, one per contact's most recent
 * conversation — no dedicated persistence, no new table (docs/decisions.md).
 */

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function widgetInbound(visitorId: string, messageId: string) {
  return {
    platformMessageId: messageId,
    sentAt: new Date(),
    body: "hi",
    attachments: [],
    contact: { platformId: visitorId, displayName: `Visitor ${visitorId}`, email: null },
    thread: { platformId: visitorId },
  };
}

describe("listBroadcastTargets", () => {
  it("pairs each contact with their most recently active conversation", async () => {
    const accountId = await makeAccount(db);
    const widget = await makeChannel(db, accountId, { type: "widget", name: "Website" });

    await ingestInbound(appDb, widget, widgetInbound("v-1", "m-1"));
    await ingestInbound(appDb, widget, widgetInbound("v-2", "m-2"));

    const targets = await listBroadcastTargets(appDb, accountId);
    expect(targets.map((t) => t.displayName).sort()).toEqual([
      "Visitor v-1",
      "Visitor v-2",
    ]);
    expect(targets[0].channel.type).toBe("widget");
  });

  it("only returns contacts belonging to this account", async () => {
    const accountA = await makeAccount(db);
    const accountB = await makeAccount(db);
    const widgetA = await makeChannel(db, accountA, { type: "widget", name: "A" });
    const widgetB = await makeChannel(db, accountB, { type: "widget", name: "B" });

    await ingestInbound(appDb, widgetA, widgetInbound("v-a", "m-a"));
    await ingestInbound(appDb, widgetB, widgetInbound("v-b", "m-b"));

    const targets = await listBroadcastTargets(appDb, accountA);
    expect(targets).toHaveLength(1);
    expect(targets[0].displayName).toBe("Visitor v-a");
  });
});

describe("sendBroadcast", () => {
  it("sends to every selected contact and reports success per recipient", async () => {
    const accountId = await makeAccount(db);
    const agent = await makeAgent(db, accountId);
    const widget = await makeChannel(db, accountId, { type: "widget", name: "Website" });

    const a = await ingestInbound(appDb, widget, widgetInbound("v-1", "m-1"));
    const b = await ingestInbound(appDb, widget, widgetInbound("v-2", "m-2"));

    const results = await sendBroadcast(appDb, agent, {
      contactIds: [a.contactId, b.contactId],
      body: "We're open this weekend!",
    });

    expect(results).toEqual(
      expect.arrayContaining([
        { contactId: a.contactId, status: "sent" },
        { contactId: b.contactId, status: "sent" },
      ]),
    );

    const rows = await db.select().from(message);
    const sent = rows.filter((m) => m.body === "We're open this weekend!");
    expect(sent).toHaveLength(2);
  });

  it("keeps sending to the rest when one recipient's channel rejects delivery", async () => {
    const accountId = await makeAccount(db);
    const agent = await makeAgent(db, accountId);
    const widget = await makeChannel(db, accountId, { type: "widget", name: "Website" });
    const line = await makeChannel(db, accountId, {
      type: "line",
      name: "LINE",
      config: { channelSecret: "s", channelAccessToken: "cat" },
    });

    const good = await ingestInbound(appDb, widget, widgetInbound("v-1", "m-1"));
    const bad = await ingestInbound(appDb, line, {
      platformMessageId: "l-1",
      sentAt: new Date(),
      body: "hi",
      attachments: [],
      contact: { platformId: "U_bad", displayName: "LINE user", email: null, phone: null },
      thread: { platformId: "U_bad" },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"message":"bad token"}', { status: 401 })),
    );

    const results = await sendBroadcast(appDb, agent, {
      contactIds: [good.contactId, bad.contactId],
      body: "Sale today only",
    });

    const goodResult = results.find((r) => r.contactId === good.contactId);
    const badResult = results.find((r) => r.contactId === bad.contactId);
    expect(goodResult?.status).toBe("sent");
    expect(badResult?.status).toBe("failed");
    expect(badResult?.error).toContain("401");

    const rows = await db.select().from(message);
    expect(rows.filter((m) => m.body === "Sale today only")).toHaveLength(1);
  });

  it("reports a not-found contact without failing the whole batch", async () => {
    const accountId = await makeAccount(db);
    const agent = await makeAgent(db, accountId);
    const widget = await makeChannel(db, accountId, { type: "widget", name: "Website" });
    const good = await ingestInbound(appDb, widget, widgetInbound("v-1", "m-1"));

    const results = await sendBroadcast(appDb, agent, {
      contactIds: [good.contactId, "00000000-0000-0000-0000-000000000000"],
      body: "hello",
    });

    expect(results.find((r) => r.contactId === good.contactId)?.status).toBe("sent");
    expect(
      results.find((r) => r.contactId === "00000000-0000-0000-0000-000000000000")?.status,
    ).toBe("failed");
  });

  it("rejects an empty message", async () => {
    const accountId = await makeAccount(db);
    const agent = await makeAgent(db, accountId);
    const widget = await makeChannel(db, accountId, { type: "widget", name: "Website" });
    const contact = await ingestInbound(appDb, widget, widgetInbound("v-1", "m-1"));

    await expect(
      sendBroadcast(appDb, agent, { contactIds: [contact.contactId], body: "   " }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an empty recipient list", async () => {
    const accountId = await makeAccount(db);
    const agent = await makeAgent(db, accountId);

    await expect(
      sendBroadcast(appDb, agent, { contactIds: [], body: "hi" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not double-send a duplicated contact id", async () => {
    const accountId = await makeAccount(db);
    const agent = await makeAgent(db, accountId);
    const widget = await makeChannel(db, accountId, { type: "widget", name: "Website" });
    const a = await ingestInbound(appDb, widget, widgetInbound("v-1", "m-1"));

    const results = await sendBroadcast(appDb, agent, {
      contactIds: [a.contactId, a.contactId],
      body: "hello there",
    });

    expect(results).toHaveLength(1);
    const rows = await db.select().from(message);
    expect(rows.filter((m) => m.body === "hello there")).toHaveLength(1);
  });
});
