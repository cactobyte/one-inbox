import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { conversation, event, message } from "@/db/schema";
import { websiteAdapter } from "@/lib/channels/website/adapter";
import {
  makeAccount,
  makeAgent,
  makeChannel,
  makeTestDb,
  type TestDb,
} from "@/test/db";

import { ingestInbound } from "./ingest";
import { sendReply } from "./reply";
import { NotFoundError } from "./errors";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
});

const payload = {
  messageId: "wh-1",
  visitorId: "visitor-1",
  visitorName: "Fon",
  text: "Is the shop open today?",
};

describe("ingestInbound — idempotency", () => {
  it("writes exactly one message for the same payload twice", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId);
    const inbound = websiteAdapter.parseInbound(payload, {});

    const first = await ingestInbound(appDb, channel, inbound);
    const second = await ingestInbound(appDb, channel, inbound);

    expect(first.status).toBe("created");
    expect(second.status).toBe("duplicate");
    expect(second.messageId).toBe(first.messageId);
    expect(second.conversationId).toBe(first.conversationId);

    const messages = await db.select().from(message);
    expect(messages).toHaveLength(1);

    const conversations = await db.select().from(conversation);
    expect(conversations).toHaveLength(1);

    // created + message_received, written once — not twice.
    const events = await db
      .select()
      .from(event)
      .where(eq(event.conversationId, first.conversationId));
    expect(events.map((e) => e.type).sort()).toEqual([
      "created",
      "message_received",
    ]);
  });

  it("adds a second message to the same conversation for a new platform id", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId);

    const a = await ingestInbound(
      appDb,
      channel,
      websiteAdapter.parseInbound({ ...payload, messageId: "wh-1" }, {}),
    );
    const b = await ingestInbound(
      appDb,
      channel,
      websiteAdapter.parseInbound({ ...payload, messageId: "wh-2" }, {}),
    );

    expect(b.status).toBe("created");
    expect(b.conversationId).toBe(a.conversationId);
    expect(await db.select().from(message)).toHaveLength(2);

    const [conv] = await db.select().from(conversation);
    expect(conv.unreadCount).toBe(2);
  });
});

describe("account isolation", () => {
  it("keeps colliding platform ids on different accounts fully separate", async () => {
    const accountA = await makeAccount(db, "A");
    const accountB = await makeAccount(db, "B");
    const channelA = await makeChannel(db, accountA);
    const channelB = await makeChannel(db, accountB);

    // Identical widget payload arrives on both accounts' channels.
    const inbound = websiteAdapter.parseInbound(payload, {});
    const inA = await ingestInbound(appDb, channelA, inbound);
    const inB = await ingestInbound(appDb, channelB, inbound);

    expect(inA.contactId).not.toBe(inB.contactId);
    expect(inA.conversationId).not.toBe(inB.conversationId);
    expect(inA.accountId).toBe(accountA);
    expect(inB.accountId).toBe(accountB);

    const rowsForA = await db
      .select()
      .from(message)
      .where(eq(message.accountId, accountA));
    expect(rowsForA).toHaveLength(1);
    expect(rowsForA[0].conversationId).toBe(inA.conversationId);
  });

  it("will not let an agent reply into another account's conversation", async () => {
    const accountA = await makeAccount(db, "A");
    const accountB = await makeAccount(db, "B");
    const channelA = await makeChannel(db, accountA);

    const inbound = await ingestInbound(
      appDb,
      channelA,
      websiteAdapter.parseInbound(payload, {}),
    );

    const agentB = await makeAgent(db, accountB);

    await expect(
      sendReply(appDb, agentB, inbound.conversationId, { body: "hi" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Nothing was written on account A's conversation.
    const outbound = await db
      .select()
      .from(message)
      .where(
        and(
          eq(message.conversationId, inbound.conversationId),
          eq(message.direction, "outbound"),
        ),
      );
    expect(outbound).toHaveLength(0);

    const replied = await db
      .select()
      .from(event)
      .where(
        and(
          eq(event.conversationId, inbound.conversationId),
          eq(event.type, "replied"),
        ),
      );
    expect(replied).toHaveLength(0);
  });

  it("lets an agent reply into their own account's conversation", async () => {
    const accountA = await makeAccount(db, "A");
    const channelA = await makeChannel(db, accountA);
    const inbound = await ingestInbound(
      appDb,
      channelA,
      websiteAdapter.parseInbound(payload, {}),
    );

    const agentA = await makeAgent(db, accountA);
    const result = await sendReply(appDb, agentA, inbound.conversationId, {
      body: "Yes, until 6pm.",
    });

    expect(result.conversationId).toBe(inbound.conversationId);
    const [conv] = await db.select().from(conversation);
    expect(conv.unreadCount).toBe(0);
  });
});
