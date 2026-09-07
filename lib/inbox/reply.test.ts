import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OutboundDeliveryError } from "@/lib/channels/adapter";
import { lineAdapter } from "@/lib/channels/line/adapter";
import { message } from "@/db/schema";
import {
  makeAccount,
  makeAgent,
  makeChannel,
  makeTestDb,
  type TestDb,
} from "@/test/db";

import { ingestInbound } from "./ingest";
import { sendReply } from "./reply";

/**
 * The reply path routes to the conversation's channel adapter — no branch in
 * `sendReply` or the route (CLAUDE.md M2). A reply on a LINE conversation
 * reaches LINE's push API; the same call on the website widget is a no-op.
 */

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lineInbound(text: string, id: string) {
  return lineAdapter.parseInbound(
    {
      events: [
        {
          type: "message",
          timestamp: 1_700_000_000_000,
          source: { type: "user", userId: "U_cust" },
          message: { type: "text", id, text },
        },
      ],
    },
    {},
  )[0];
}

describe("sendReply routes by channel", () => {
  it("delivers a LINE reply through the push API and stores its platform id", async () => {
    const accountId = await makeAccount(db);
    const agent = await makeAgent(db, accountId);
    const line = await makeChannel(db, accountId, {
      type: "line",
      name: "LINE",
      config: { channelSecret: "s", channelAccessToken: "cat-1" },
    });

    const inbound = await ingestInbound(appDb, line, lineInbound("hello?", "in-1"));

    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ sentMessages: [{ id: "line-out-1" }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendReply(appDb, agent, inbound.conversationId, {
      body: "Yes — open until 6pm.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(JSON.parse(init.body as string)).toEqual({
      to: "U_cust",
      messages: [{ type: "text", text: "Yes — open until 6pm." }],
    });
    expect(result.platformMessageId).toBe("line-out-1");

    const rows = await db.select().from(message);
    const outbound = rows.find((m) => m.direction === "outbound")!;
    expect(outbound.platformMessageId).toBe("line-out-1");
    expect(outbound.channelId).toBe(line.id);
  });

  it("does not call any platform API for a website-widget reply", async () => {
    const accountId = await makeAccount(db);
    const agent = await makeAgent(db, accountId);
    const widget = await makeChannel(db, accountId, { type: "widget", name: "Website" });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const inbound = await ingestInbound(appDb, widget, {
      platformMessageId: "w-1",
      sentAt: new Date(),
      body: "hi",
      attachments: [],
      contact: { platformId: "v-1", displayName: "Visitor", email: null },
      thread: { platformId: "v-1" },
    });

    const result = await sendReply(appDb, agent, inbound.conversationId, {
      body: "Hello!",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.platformMessageId).toBeNull();
  });

  it("propagates OutboundDeliveryError when LINE rejects the push", async () => {
    const accountId = await makeAccount(db);
    const agent = await makeAgent(db, accountId);
    const line = await makeChannel(db, accountId, {
      type: "line",
      name: "LINE",
      config: { channelSecret: "s", channelAccessToken: "cat-1" },
    });
    const inbound = await ingestInbound(appDb, line, lineInbound("hello?", "in-1"));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"message":"bad token"}', { status: 401 })),
    );

    await expect(
      sendReply(appDb, agent, inbound.conversationId, { body: "hi" }),
    ).rejects.toBeInstanceOf(OutboundDeliveryError);

    // Nothing persisted — delivery is attempted before the DB write.
    const rows = await db.select().from(message);
    expect(rows.filter((m) => m.direction === "outbound")).toHaveLength(0);
  });
});
