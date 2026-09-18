import { afterEach, describe, expect, it, vi } from "vitest";

import { InvalidPayloadError, OutboundDeliveryError } from "../adapter";
import { messengerAdapter } from "./adapter";

function webhook(messaging: unknown[]) {
  return {
    object: "page",
    entry: [{ id: "PAGE_ID", time: 1700000000000, messaging }],
  };
}

function textMessaging(overrides: Record<string, unknown> = {}) {
  return {
    sender: { id: "PSID_1" },
    recipient: { id: "PAGE_ID" },
    timestamp: 1700000000000,
    message: { mid: "mid.abc", text: "Is this in stock?" },
    ...overrides,
  };
}

describe("messengerAdapter.parseInbound", () => {
  it("normalises a text message", () => {
    const [msg, ...rest] = messengerAdapter.parseInbound(webhook([textMessaging()]), {});

    expect(rest).toHaveLength(0);
    expect(msg).toEqual({
      platformMessageId: "mid.abc",
      sentAt: new Date(1700000000000),
      body: "Is this in stock?",
      attachments: [],
      contact: {
        platformId: "PSID_1",
        displayName: "Facebook user",
        email: null,
        phone: null,
      },
      thread: { platformId: "PSID_1" },
    });
  });

  it("returns every message in one batched delivery", () => {
    const msgs = messengerAdapter.parseInbound(
      webhook([
        textMessaging({ message: { mid: "a", text: "one" } }),
        textMessaging({ message: { mid: "b", text: "two" } }),
      ]),
      {},
    );
    expect(msgs.map((m) => m.platformMessageId)).toEqual(["a", "b"]);
    expect(msgs.map((m) => m.body)).toEqual(["one", "two"]);
  });

  it("skips a delivery/read receipt or postback (no message.text)", () => {
    const msgs = messengerAdapter.parseInbound(
      webhook([{ sender: { id: "PSID_1" }, delivery: { mids: ["mid.abc"] } }]),
      {},
    );
    expect(msgs).toEqual([]);
  });

  it("rejects a body that is not a Messenger webhook envelope", () => {
    expect(() => messengerAdapter.parseInbound({ foo: "bar" }, {})).toThrow(
      InvalidPayloadError,
    );
    expect(() => messengerAdapter.parseInbound({ entry: "x" }, {})).toThrow(
      /"entry" must be an array/,
    );
  });

  it("defaults sentAt when the messaging item has no usable timestamp", () => {
    const before = Date.now();
    const [msg] = messengerAdapter.parseInbound(
      webhook([textMessaging({ timestamp: undefined })]),
      {},
    );
    expect(msg.sentAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("messengerAdapter.sendOutbound", () => {
  const config = { pageAccessToken: "page-token-123", appSecret: "shh" };
  const outbound = { body: "Yes, in stock!", attachments: [], thread: { platformId: "PSID_1" } };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the reply and reads back the platform message id", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ message_id: "mid.out-9" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await messengerAdapter.sendOutbound(outbound, config);

    expect(result.platformMessageId).toBe("mid.out-9");
    expect(result.deliveredAt).toBeInstanceOf(Date);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v20.0/me/messages");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer page-token-123",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      recipient: { id: "PSID_1" },
      message: { text: "Yes, in stock!" },
    });
  });

  it("throws OutboundDeliveryError when Messenger rejects the send", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":{"message":"invalid token"}}', { status: 401 })),
    );
    await expect(messengerAdapter.sendOutbound(outbound, config)).rejects.toThrow(
      OutboundDeliveryError,
    );
  });

  it("throws when the channel has no page access token", async () => {
    await expect(messengerAdapter.sendOutbound(outbound, {})).rejects.toThrow(
      /pageAccessToken/,
    );
  });

  it("throws on an attachment-only reply (text only for now)", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      messengerAdapter.sendOutbound({ ...outbound, body: "   " }, config),
    ).rejects.toThrow(/text replies only/);
  });
});
