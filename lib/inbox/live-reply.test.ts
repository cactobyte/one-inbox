import { describe, expect, it } from "vitest";

import { websiteAdapter } from "@/lib/channels/website/adapter";

import { ingestInbound } from "./ingest";
import { sendReply } from "./reply";
import { fetchMessagesSince } from "./stream";
import { makeAccount, makeAgent, makeChannel, makeTestDb } from "../../test/db";

/**
 * Day 4 task 10/12: a reply sent from the inbox must reach a connected
 * widget live, through the same SSE mechanism from day 3 — not a new send
 * path and not a new receive path. This proves the mechanism: writing a
 * reply via sendReply (the one send path) is picked up by
 * fetchMessagesSince (the one stream mechanism) on its very next poll,
 * with no widget-side refresh involved. The actual HTTP/EventSource
 * plumbing is verified manually (see docs/decisions.md) — this is the part of
 * it that has real logic to get wrong.
 */
describe("an agent reply reaches the stream the widget is polling", () => {
  it("appears in fetchMessagesSince using the cursor the widget already had", async () => {
    const { db, appDb } = await makeTestDb();
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId);
    const agent = await makeAgent(db, accountId);

    const inbound = await ingestInbound(
      appDb,
      channel,
      websiteAdapter.parseInbound({ messageId: "m1", visitorId: "v1", text: "Hi" }, {})[0],
    );

    // The widget's stream has already delivered everything up to here.
    const before = await fetchMessagesSince(appDb, inbound.conversationId, null);
    expect(before.messages.map((m) => m.body)).toEqual(["Hi"]);

    // The agent replies through the one existing send path.
    await sendReply(appDb, agent, inbound.conversationId, {
      body: "Yes, we're open until 6pm.",
    });

    // The widget's next poll, resuming from the cursor it already had,
    // picks the reply up — no refresh, no separate mechanism.
    const after = await fetchMessagesSince(appDb, inbound.conversationId, before.nextCursor);
    expect(after.messages).toHaveLength(1);
    expect(after.messages[0]).toMatchObject({
      body: "Yes, we're open until 6pm.",
      direction: "outbound",
    });
  });
});
