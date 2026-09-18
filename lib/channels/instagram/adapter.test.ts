import { afterEach, describe, expect, it, vi } from "vitest";

import { InvalidPayloadError, OutboundDeliveryError } from "../adapter";
import { instagramAdapter } from "./adapter";

function webhook(messaging: unknown[]) {
  return {
    object: "instagram",
    entry: [{ id: "IG_ID", time: 1700000000000, messaging }],
  };
}

function textMessaging(overrides: Record<string, unknown> = {}) {
  return {
    sender: { id: "IGSID_1" },
    recipient: { id: "IG_ID" },
    timestamp: 1700000000000,
    message: { mid: "mid.abc", text: "Is this in stock?" },
    ...overrides,
  };
}

describe("instagramAdapter.parseInbound", () => {
  it("normalises a text message", () => {
    const [msg, ...rest] = instagramAdapter.parseInbound(webhook([textMessaging()]), {});

    expect(rest).toHaveLength(0);
    expect(msg).toEqual({
      platformMessageId: "mid.abc",
      sentAt: new Date(1700000000000),
      body: "Is this in stock?",
      attachments: [],
      contact: {
        platformId: "IGSID_1",
        displayName: "Instagram user",
        email: null,
        phone: null,
      },
      thread: { platformId: "IGSID_1" },
    });
  });

  it("returns every message in one batched delivery", () => {
    const msgs = instagramAdapter.parseInbound(
      webhook([
        textMessaging({ message: { mid: "a", text: "one" } }),
        textMessaging({ message: { mid: "b", text: "two" } }),
      ]),
      {},
    );
    expect(msgs.map((m) => m.platformMessageId)).toEqual(["a", "b"]);
    expect(msgs.map((m) => m.body)).toEqual(["one", "two"]);
  });

  it("skips a delivery/read receipt or story reaction (no message.text)", () => {
    const msgs = instagramAdapter.parseInbound(
      webhook([{ sender: { id: "IGSID_1" }, delivery: { mids: ["mid.abc"] } }]),
      {},
    );
    expect(msgs).toEqual([]);
  });

  it("rejects a body that is not an Instagram webhook envelope", () => {
    expect(() => instagramAdapter.parseInbound({ foo: "bar" }, {})).toThrow(
      InvalidPayloadError,
    );
    expect(() => instagramAdapter.parseInbound({ entry: "x" }, {})).toThrow(
      /"entry" must be an array/,
    );
  });

  it("defaults sentAt when the messaging item has no usable timestamp", () => {
    const before = Date.now();
    const [msg] = instagramAdapter.parseInbound(
      webhook([textMessaging({ timestamp: undefined })]),
      {},
    );
    expect(msg.sentAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("instagramAdapter.sendOutbound", () => {
  const config = { pageAccessToken: "page-token-123", appSecret: "shh" };
  const outbound = { body: "Yes, in stock!", attachments: [], thread: { platformId: "IGSID_1" } };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the reply and reads back the platform message id", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ message_id: "mid.out-9" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await instagramAdapter.sendOutbound(outbound, config);

    expect(result.platformMessageId).toBe("mid.out-9");
    expect(result.deliveredAt).toBeInstanceOf(Date);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v20.0/me/messages");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer page-token-123",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      recipient: { id: "IGSID_1" },
      message: { text: "Yes, in stock!" },
    });
  });

  it("throws OutboundDeliveryError when Instagram rejects the send", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":{"message":"invalid token"}}', { status: 401 })),
    );
    await expect(instagramAdapter.sendOutbound(outbound, config)).rejects.toThrow(
      OutboundDeliveryError,
    );
  });

  it("throws when the channel has no page access token", async () => {
    await expect(instagramAdapter.sendOutbound(outbound, {})).rejects.toThrow(
      /pageAccessToken/,
    );
  });

  it("throws on an attachment-only reply (text only for now)", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      instagramAdapter.sendOutbound({ ...outbound, body: "   " }, config),
    ).rejects.toThrow(/text replies only/);
  });
});
