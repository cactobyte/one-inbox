import { afterEach, describe, expect, it, vi } from "vitest";

import { InvalidPayloadError, OutboundDeliveryError } from "../adapter";
import { lineAdapter } from "./adapter";

/** A LINE `message`/`text` webhook event from a 1:1 user chat. */
function textEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "message",
    mode: "active",
    timestamp: 1_700_000_000_000,
    source: { type: "user", userId: "U_alice" },
    replyToken: "reply-token-abc",
    message: { type: "text", id: "line-msg-1", text: "สวัสดีค่ะ" },
    deliveryContext: { isRedelivery: false },
    ...overrides,
  };
}

function webhook(events: unknown[]) {
  return { destination: "U_official_account", events };
}

describe("lineAdapter.parseInbound", () => {
  it("normalises a text message from a 1:1 chat", () => {
    const [msg, ...rest] = lineAdapter.parseInbound(webhook([textEvent()]), {});

    expect(rest).toHaveLength(0);
    expect(msg).toEqual({
      platformMessageId: "line-msg-1",
      sentAt: new Date(1_700_000_000_000),
      body: "สวัสดีค่ะ",
      attachments: [],
      contact: {
        platformId: "U_alice",
        displayName: "LINE user",
        email: null,
        phone: null,
      },
      thread: { platformId: "U_alice" },
    });
  });

  it("returns every message event in one batched delivery", () => {
    const msgs = lineAdapter.parseInbound(
      webhook([
        textEvent({ message: { type: "text", id: "a", text: "one" } }),
        textEvent({ message: { type: "text", id: "b", text: "two" } }),
      ]),
      {},
    );

    expect(msgs.map((m) => m.platformMessageId)).toEqual(["a", "b"]);
    expect(msgs.map((m) => m.body)).toEqual(["one", "two"]);
  });

  it("shows a placeholder body for a non-text message, no attachment", () => {
    const [msg] = lineAdapter.parseInbound(
      webhook([textEvent({ message: { type: "sticker", id: "s1" } })]),
      {},
    );
    expect(msg.body).toBe("[sticker]");
    expect(msg.attachments).toEqual([]);
  });

  it("skips non-message events (follow, unfollow, postback)", () => {
    const msgs = lineAdapter.parseInbound(
      webhook([
        { type: "follow", source: { type: "user", userId: "U_x" } },
        { type: "unfollow", source: { type: "user", userId: "U_x" } },
        { type: "postback", source: { type: "user", userId: "U_x" }, postback: {} },
      ]),
      {},
    );
    expect(msgs).toEqual([]);
  });

  it("skips messages from a group or room (M1 is 1:1 only)", () => {
    const msgs = lineAdapter.parseInbound(
      webhook([
        textEvent({ source: { type: "group", groupId: "G1", userId: "U_a" } }),
        textEvent({ source: { type: "room", roomId: "R1", userId: "U_a" } }),
      ]),
      {},
    );
    expect(msgs).toEqual([]);
  });

  it("tolerates the verification ping (empty events array)", () => {
    expect(lineAdapter.parseInbound(webhook([]), {})).toEqual([]);
  });

  it("rejects a body that is not a LINE webhook envelope", () => {
    expect(() => lineAdapter.parseInbound({ foo: "bar" }, {})).toThrow(
      InvalidPayloadError,
    );
    expect(() => lineAdapter.parseInbound("nope", {})).toThrow(
      InvalidPayloadError,
    );
    expect(() => lineAdapter.parseInbound({ events: "x" }, {})).toThrow(
      /"events" must be an array/,
    );
  });

  it("defaults sentAt when the event has no usable timestamp", () => {
    const before = Date.now();
    const [msg] = lineAdapter.parseInbound(
      webhook([textEvent({ timestamp: undefined })]),
      {},
    );
    expect(msg.sentAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("lineAdapter.sendOutbound", () => {
  const config = { channelAccessToken: "cat-123", channelSecret: "shh" };
  const outbound = {
    body: "Yes, we're open until 6pm.",
    attachments: [],
    thread: { platformId: "U_alice" },
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pushes the reply and reads back the platform message id", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ sentMessages: [{ id: "line-out-9" }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await lineAdapter.sendOutbound(outbound, config);

    expect(result.platformMessageId).toBe("line-out-9");
    expect(result.deliveredAt).toBeInstanceOf(Date);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer cat-123",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      to: "U_alice",
      messages: [{ type: "text", text: "Yes, we're open until 6pm." }],
    });
  });

  it("accepts an older push response with no message id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const result = await lineAdapter.sendOutbound(outbound, config);
    expect(result.platformMessageId).toBeNull();
  });

  it("throws OutboundDeliveryError when LINE rejects the push", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"message":"invalid token"}', { status: 401 })),
    );
    await expect(lineAdapter.sendOutbound(outbound, config)).rejects.toThrow(
      OutboundDeliveryError,
    );
  });

  it("throws when the channel has no access token", async () => {
    await expect(
      lineAdapter.sendOutbound(outbound, { channelSecret: "shh" }),
    ).rejects.toThrow(/channelAccessToken/);
  });

  it("throws on an attachment-only reply (M1 is text only)", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      lineAdapter.sendOutbound({ ...outbound, body: "   " }, config),
    ).rejects.toThrow(/text replies only/);
  });
});
