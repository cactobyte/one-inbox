import { describe, expect, it } from "vitest";

import { websiteAdapter } from "@/lib/channels/website/adapter";
import { ingestInbound } from "@/lib/inbox/ingest";

import { getOrCreateVisitorId, type StorageLike } from "../widget/src/identity";
import { makeAccount, makeChannel, makeTestDb } from "./db";

function fakeStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("visitor identity threading (widget identity + server ingest)", () => {
  it("a reloaded visitor's second message lands in the same conversation", async () => {
    const { db, appDb } = await makeTestDb();
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId);

    // The widget's persistent storage, as it would survive a page reload.
    const storage = fakeStorage();

    // First page load: mint (and persist) a visitor id, send a message.
    const visitorIdBeforeReload = getOrCreateVisitorId(storage, channel.id);
    const first = await ingestInbound(
      appDb,
      channel,
      websiteAdapter.parseInbound(
        { messageId: "m1", visitorId: visitorIdBeforeReload, text: "Hi" },
        {},
      )[0],
    );

    // Simulated reload: a fresh call against the SAME storage should read
    // back the same id, not mint a new one.
    const visitorIdAfterReload = getOrCreateVisitorId(storage, channel.id);
    expect(visitorIdAfterReload).toBe(visitorIdBeforeReload);

    const second = await ingestInbound(
      appDb,
      channel,
      websiteAdapter.parseInbound(
        { messageId: "m2", visitorId: visitorIdAfterReload, text: "Still there?" },
        {},
      )[0],
    );

    expect(second.conversationId).toBe(first.conversationId);
    expect(second.contactId).toBe(first.contactId);
  });
});
