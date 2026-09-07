import { beforeEach, describe, expect, it } from "vitest";

import { lineAdapter } from "@/lib/channels/line/adapter";
import { websiteAdapter } from "@/lib/channels/website/adapter";

import { NotFoundError } from "./errors";
import { ingestInbound } from "./ingest";
import { getOwnedConversation, listConversations, listMessages } from "./queries";
import { sendReply } from "./reply";
import {
  makeAccount,
  makeAgent,
  makeChannel,
  makeTestDb,
  type TestDb,
} from "../../test/db";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
});

async function seedConversation(accountId: string, channel: { id: string; accountId: string }, visitorId: string, text: string) {
  return ingestInbound(
    appDb,
    channel,
    websiteAdapter.parseInbound({ messageId: `${visitorId}-1`, visitorId, text }, {})[0],
  );
}

describe("account isolation at the query layer", () => {
  it("listConversations for account B never includes account A's rows, even by id", async () => {
    const accountA = await makeAccount(db, "A");
    const accountB = await makeAccount(db, "B");
    const channelA = await makeChannel(db, accountA);
    const channelB = await makeChannel(db, accountB);

    const inA = await seedConversation(accountA, channelA, "visitor-a", "hi from A");
    await seedConversation(accountB, channelB, "visitor-b", "hi from B");

    const { items } = await listConversations(appDb, accountB);
    expect(items).toHaveLength(1);
    expect(items.map((c) => c.id)).not.toContain(inA.conversationId);
  });

  it("getOwnedConversation 404s on a real conversation id from another account", async () => {
    const accountA = await makeAccount(db, "A");
    const accountB = await makeAccount(db, "B");
    const channelA = await makeChannel(db, accountA);

    const inA = await seedConversation(accountA, channelA, "visitor-a", "hi from A");

    // This is a real, existing conversation id — just not account B's.
    await expect(
      getOwnedConversation(appDb, accountB, inA.conversationId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("listMessages 404s (not empty-list) on a guessed/enumerated foreign id", async () => {
    const accountA = await makeAccount(db, "A");
    const accountB = await makeAccount(db, "B");
    const channelA = await makeChannel(db, accountA);

    const inA = await seedConversation(accountA, channelA, "visitor-a", "hi from A");

    await expect(
      listMessages(appDb, accountB, inA.conversationId),
    ).rejects.toBeInstanceOf(NotFoundError);

    // And a conversation id that was never real at all behaves identically —
    // account B can't tell the two cases apart.
    await expect(
      listMessages(appDb, accountB, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an agent from account B cannot act on account A's conversation via sendReply", async () => {
    const accountA = await makeAccount(db, "A");
    const accountB = await makeAccount(db, "B");
    const channelA = await makeChannel(db, accountA);

    const inA = await seedConversation(accountA, channelA, "visitor-a", "hi from A");
    const agentB = await makeAgent(db, accountB);

    await expect(
      sendReply(appDb, agentB, inA.conversationId, { body: "not yours" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an agent from account A can list and read their own conversation", async () => {
    const accountA = await makeAccount(db, "A");
    const channelA = await makeChannel(db, accountA);
    const inA = await seedConversation(accountA, channelA, "visitor-a", "hi from A");

    const owned = await getOwnedConversation(appDb, accountA, inA.conversationId);
    expect(owned.contact.displayName).toBe("Website visitor");

    const { items } = await listMessages(appDb, accountA, inA.conversationId);
    expect(items.map((m) => m.body)).toEqual(["hi from A"]);
  });
});

describe("listConversations shape", () => {
  it("includes a last-message preview, most recently active first", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId);
    await seedConversation(accountId, channel, "v1", "first thread");
    await new Promise((r) => setTimeout(r, 5));
    await seedConversation(accountId, channel, "v2", "second thread");

    const { items } = await listConversations(appDb, accountId);
    expect(items).toHaveLength(2);
    expect(items[0].lastMessage).toEqual({ body: "second thread", direction: "inbound" });
    expect(items[1].lastMessage).toEqual({ body: "first thread", direction: "inbound" });
  });
});

describe("multi-channel inbox (M2)", () => {
  it("returns website and LINE conversations in one list, each tagged with its channel", async () => {
    const accountId = await makeAccount(db);
    const widget = await makeChannel(db, accountId, {
      type: "widget",
      name: "Website",
    });
    const line = await makeChannel(db, accountId, {
      type: "line",
      name: "LINE",
      config: { channelSecret: "s" },
    });

    await seedConversation(accountId, widget, "web-visitor", "from the website");
    await new Promise((r) => setTimeout(r, 5));
    await ingestInbound(
      appDb,
      line,
      lineAdapter.parseInbound(
        {
          events: [
            {
              type: "message",
              timestamp: 1_700_000_000_000,
              source: { type: "user", userId: "U_line" },
              message: { type: "text", id: "line-1", text: "from LINE" },
            },
          ],
        },
        {},
      )[0],
    );

    const { items } = await listConversations(appDb, accountId);

    expect(items).toHaveLength(2);
    // Both channels present, no filtering by type.
    expect(items.map((c) => c.channel.type).sort()).toEqual(["line", "widget"]);

    const lineRow = items.find((c) => c.channel.type === "line")!;
    expect(lineRow.channel.name).toBe("LINE");
    expect(lineRow.lastMessage?.body).toBe("from LINE");
    expect(lineRow.channel.id).toBe(line.id);
  });

  it("getOwnedConversation carries the channel for the detail header", async () => {
    const accountId = await makeAccount(db);
    const line = await makeChannel(db, accountId, {
      type: "line",
      name: "LINE",
      config: { channelSecret: "s" },
    });
    const inbound = await ingestInbound(
      appDb,
      line,
      lineAdapter.parseInbound(
        {
          events: [
            {
              type: "message",
              timestamp: 1_700_000_000_000,
              source: { type: "user", userId: "U_line" },
              message: { type: "text", id: "line-1", text: "hi" },
            },
          ],
        },
        {},
      )[0],
    );

    const owned = await getOwnedConversation(
      appDb,
      accountId,
      inbound.conversationId,
    );
    expect(owned.channel).toEqual({ id: line.id, type: "line", name: "LINE" });
  });
});
