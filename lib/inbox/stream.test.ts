import { beforeEach, describe, expect, it } from "vitest";

import { message } from "@/db/schema";
import { websiteAdapter } from "@/lib/channels/website/adapter";

import { decodeCursor, encodeCursor } from "./cursor";
import { ingestInbound } from "./ingest";
import { sendReply } from "./reply";
import { fetchMessagesSince } from "./stream";
import { makeAccount, makeAgent, makeChannel, makeTestDb, type TestDb } from "../../test/db";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];
let accountId: string;
let channelId: string;
let conversationId: string;

async function send(messageId: string, text: string) {
  await ingestInbound(
    appDb,
    { id: channelId, accountId },
    websiteAdapter.parseInbound({ messageId, visitorId: "v1", text }, {}),
  );
}

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
  accountId = await makeAccount(db);
  const channel = await makeChannel(db, accountId);
  channelId = channel.id;
  await send("seed-1", "first");
  const [row] = await db
    .select({ conversationId: message.conversationId })
    .from(message)
    .limit(1);
  conversationId = row.conversationId;
});

describe("cursor", () => {
  it("round-trips", () => {
    const c = { createdAt: new Date("2026-01-01T00:00:00.000Z"), id: "abc" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("treats garbage as no cursor (null)", () => {
    expect(decodeCursor("not-a-real-cursor")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});

describe("fetchMessagesSince — message identity for widget reconciliation", () => {
  // Regression: a widget renders its own send optimistically under the
  // client-generated id it POSTed (day 2's platformMessageId). If the
  // stream exposes only the DB row id for that same message, the widget
  // can't tell "this is the message I already showed" from "this is new"
  // and renders it a second time. Caught by loading the real widget in a
  // browser, not by this suite originally — this test is what should have.
  it("an inbound message keeps its platformMessageId (the sender's own id)", async () => {
    const { messages } = await fetchMessagesSince(appDb, conversationId, null);
    expect(messages[0].platformMessageId).toBe("seed-1");
  });

  it("an agent reply (no client-generated id) has a null platformMessageId", async () => {
    const agent = await makeAgent(db, accountId);
    const before = await fetchMessagesSince(appDb, conversationId, null);
    await sendReply(appDb, agent, conversationId, { body: "reply" });
    const after = await fetchMessagesSince(appDb, conversationId, before.nextCursor);
    expect(after.messages[0]).toMatchObject({ body: "reply", platformMessageId: null });
  });
});

describe("fetchMessagesSince — reconnect semantics", () => {
  it("a fresh connection (no cursor) gets everything so far", async () => {
    const { messages } = await fetchMessagesSince(appDb, conversationId, null);
    expect(messages.map((m) => m.body)).toEqual(["first"]);
  });

  it("reconnecting with the previous cursor gets only what's new — no dupes, no drops", async () => {
    const page1 = await fetchMessagesSince(appDb, conversationId, null);
    expect(page1.messages).toHaveLength(1);

    // "Disconnected" here: nothing is fetched while these are written.
    await send("seed-2", "second");
    await send("seed-3", "third");

    // "Reconnect" with the last cursor the client actually saw.
    const page2 = await fetchMessagesSince(appDb, conversationId, page1.nextCursor);

    expect(page2.messages.map((m) => m.body)).toEqual(["second", "third"]);

    const allIds = [...page1.messages, ...page2.messages].map((m) => m.id);
    expect(new Set(allIds).size).toBe(allIds.length); // no duplicates across pages
  });

  it("reconnecting with the latest cursor and nothing new gets an empty page", async () => {
    const page1 = await fetchMessagesSince(appDb, conversationId, null);
    const page2 = await fetchMessagesSince(appDb, conversationId, page1.nextCursor);
    expect(page2.messages).toHaveLength(0);
    // Cursor is preserved, not reset, so a third reconnect isn't a full resend.
    expect(page2.nextCursor).toBe(page1.nextCursor);
  });

  it("breaks ties on id when two messages share a timestamp", async () => {
    // Comfortably after the seeded "first" message's auto `now()` timestamp,
    // whatever the system clock is when this test runs.
    const sameInstant = new Date(Date.now() + 60 * 60 * 1000);
    const tiedValues = {
      accountId,
      conversationId,
      channelId,
      direction: "outbound" as const,
      authorType: "system" as const,
      sentAt: sameInstant,
      createdAt: sameInstant,
    };
    const [a] = await db
      .insert(message)
      .values({ ...tiedValues, body: "tie-a" })
      .returning({ id: message.id });
    const [b] = await db
      .insert(message)
      .values({ ...tiedValues, body: "tie-b" })
      .returning({ id: message.id });

    const ordered = [a.id, b.id].sort();

    const page1 = await fetchMessagesSince(appDb, conversationId, null);
    const tied = page1.messages.filter((m) => m.body.startsWith("tie-"));
    expect(tied.map((m) => m.id)).toEqual(ordered);

    // Resuming from a cursor pointing at the *first* of the tied pair must
    // still return the second — the tiebreak can't drop it.
    const midCursor = encodeCursor({ createdAt: sameInstant, id: ordered[0] });
    const page2 = await fetchMessagesSince(appDb, conversationId, midCursor);
    expect(page2.messages.map((m) => m.id)).toEqual([ordered[1]]);
  });
});
