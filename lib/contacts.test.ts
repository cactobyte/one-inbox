import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { conversation } from "@/db/schema";
import { lineAdapter } from "@/lib/channels/line/adapter";
import { websiteAdapter } from "@/lib/channels/website/adapter";
import { NotFoundError } from "@/lib/inbox/errors";
import { ingestInbound } from "@/lib/inbox/ingest";
import { makeAccount, makeChannel, makeTestDb, type TestDb } from "@/test/db";

import { getOwnedContact, listContactConversations, updateContactNotes } from "./contacts";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
});

async function seedConversation(
  channel: { id: string; accountId: string },
  visitorId: string,
  text: string,
) {
  return ingestInbound(
    appDb,
    channel,
    websiteAdapter.parseInbound({ messageId: `${visitorId}-1`, visitorId, text }, {})[0],
  );
}

describe("getOwnedContact", () => {
  it("returns a contact scoped to its account", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId);
    const { contactId } = await seedConversation(channel, "visitor-1", "hi");

    const profile = await getOwnedContact(appDb, accountId, contactId);
    expect(profile.displayName).toBe("Website visitor");
  });

  it("404s on a real contact id from another account", async () => {
    const accountA = await makeAccount(db, "A");
    const accountB = await makeAccount(db, "B");
    const channelA = await makeChannel(db, accountA);
    const { contactId } = await seedConversation(channelA, "visitor-a", "hi from A");

    await expect(getOwnedContact(appDb, accountB, contactId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("listContactConversations", () => {
  it("returns conversations across every channel for one contact, most recent first", async () => {
    const accountId = await makeAccount(db);
    const widget = await makeChannel(db, accountId, { type: "widget", name: "Website" });
    const line = await makeChannel(db, accountId, {
      type: "line",
      name: "LINE",
      config: { channelSecret: "s" },
    });

    const web = await seedConversation(widget, "web-visitor", "from the website");
    await new Promise((r) => setTimeout(r, 5));
    const lineResult = await ingestInbound(
      appDb,
      line,
      lineAdapter.parseInbound(
        {
          events: [
            {
              type: "message",
              timestamp: Date.now(),
              source: { type: "user", userId: "U_line" },
              message: { type: "text", id: "line-1", text: "from LINE" },
            },
          ],
        },
        {},
      )[0],
    );

    // Same human on two channels is a real, unsolved merge case
    // (docs/decisions.md) — simulate it by pointing the LINE conversation at
    // the website contact, the way a future merge feature would, and assert
    // the profile query itself (not ingestion) surfaces both.
    await db
      .update(conversation)
      .set({ contactId: web.contactId })
      .where(eq(conversation.id, lineResult.conversationId));

    const items = await listContactConversations(appDb, accountId, web.contactId);

    expect(items).toHaveLength(2);
    expect(items.map((c) => c.channel.type).sort()).toEqual(["line", "widget"]);
    expect(items[0].channel.type).toBe("line"); // most recently active first
    expect(items[0].lastMessage).toEqual({ body: "from LINE", direction: "inbound" });
  });

  it("404s (not empty-list) on a guessed/foreign contact id", async () => {
    const accountA = await makeAccount(db, "A");
    const accountB = await makeAccount(db, "B");
    const channelA = await makeChannel(db, accountA);
    const { contactId } = await seedConversation(channelA, "visitor-a", "hi from A");

    await expect(
      listContactConversations(appDb, accountB, contactId),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      listContactConversations(appDb, accountB, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("updateContactNotes", () => {
  it("saves notes, scoped to the account", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId);
    const { contactId } = await seedConversation(channel, "visitor-1", "hi");

    await updateContactNotes(appDb, accountId, contactId, "Prefers email over LINE.");

    const profile = await getOwnedContact(appDb, accountId, contactId);
    expect(profile.notes).toBe("Prefers email over LINE.");
  });

  it("clears notes when given null", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId);
    const { contactId } = await seedConversation(channel, "visitor-1", "hi");

    await updateContactNotes(appDb, accountId, contactId, "temp");
    await updateContactNotes(appDb, accountId, contactId, null);

    const profile = await getOwnedContact(appDb, accountId, contactId);
    expect(profile.notes).toBeNull();
  });

  it("404s and writes nothing for another account's contact", async () => {
    const accountA = await makeAccount(db, "A");
    const accountB = await makeAccount(db, "B");
    const channelA = await makeChannel(db, accountA);
    const { contactId } = await seedConversation(channelA, "visitor-a", "hi from A");

    await expect(
      updateContactNotes(appDb, accountB, contactId, "not yours"),
    ).rejects.toBeInstanceOf(NotFoundError);

    const profile = await getOwnedContact(appDb, accountA, contactId);
    expect(profile.notes).toBeNull();
  });
});
