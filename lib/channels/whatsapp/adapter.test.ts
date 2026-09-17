import { afterEach, describe, expect, it, vi } from "vitest";

import { InvalidPayloadError, OutboundDeliveryError } from "../adapter";
import { whatsappAdapter } from "./adapter";

/** A WhatsApp Cloud API `messages` webhook body carrying one text message. */
function webhook(
  messages: unknown[],
  contacts: unknown[] = [{ profile: { name: "Nok" }, wa_id: "66812345678" }],
) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "PN_ID" },
              contacts,
              messages,
            },
          },
        ],
      },
    ],
  };
}

function textMessage(overrides: Record<string, unknown> = {}) {
  return {
    from: "66812345678",
    id: "wamid.abc",
    timestamp: "1700000000",
    type: "text",
    text: { body: "สวัสดีค่ะ" },
    ...overrides,
  };
}

describe("whatsappAdapter.parseInbound", () => {
  it("normalises a text message", () => {
    const [msg, ...rest] = whatsappAdapter.parseInbound(webhook([textMessage()]), {});

    expect(rest).toHaveLength(0);
    expect(msg).toEqual({
      platformMessageId: "wamid.abc",
      sentAt: new Date(1_700_000_000 * 1000),
      body: "สวัสดีค่ะ",
      attachments: [],
      contact: {
        platformId: "66812345678",
        displayName: "Nok",
        email: null,
        phone: "+66812345678",
      },
      thread: { platformId: "66812345678" },
    });
  });

  it("returns every message in one batched delivery", () => {
    const msgs = whatsappAdapter.parseInbound(
      webhook([
        textMessage({ id: "a", text: { body: "one" } }),
        textMessage({ id: "b", text: { body: "two" } }),
      ]),
      {},
    );

    expect(msgs.map((m) => m.platformMessageId)).toEqual(["a", "b"]);
    expect(msgs.map((m) => m.body)).toEqual(["one", "two"]);
  });

  it("shows a placeholder body for a non-text message, no attachment", () => {
    const [msg] = whatsappAdapter.parseInbound(
      webhook([textMessage({ type: "sticker", text: undefined })]),
      {},
    );
    expect(msg.body).toBe("[sticker]");
    expect(msg.attachments).toEqual([]);
  });

  it("falls back to a generic name when no contact profile matches", () => {
    const [msg] = whatsappAdapter.parseInbound(webhook([textMessage()], []), {});
    expect(msg.contact.displayName).toBe("WhatsApp user");
  });

  it("tolerates a delivery with no messages (a status-only update)", () => {
    const body = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: { statuses: [{ id: "wamid.abc", status: "read" }] },
            },
          ],
        },
      ],
    };
    expect(whatsappAdapter.parseInbound(body, {})).toEqual([]);
  });

  it("rejects a body that is not a WhatsApp webhook envelope", () => {
    expect(() => whatsappAdapter.parseInbound({ foo: "bar" }, {})).toThrow(
      InvalidPayloadError,
    );
    expect(() => whatsappAdapter.parseInbound("nope", {})).toThrow(
      InvalidPayloadError,
    );
    expect(() => whatsappAdapter.parseInbound({ entry: "x" }, {})).toThrow(
      /"entry" must be an array/,
    );
  });

  it("defaults sentAt when the message has no usable timestamp", () => {
    const before = Date.now();
    const [msg] = whatsappAdapter.parseInbound(
      webhook([textMessage({ timestamp: undefined })]),
      {},
    );
    expect(msg.sentAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("whatsappAdapter.sendOutbound", () => {
  const config = { accessToken: "token-123", phoneNumberId: "PN_ID", appSecret: "shh" };
  const outbound = {
    body: "Yes, we're open until 6pm.",
    attachments: [],
    thread: { platformId: "66812345678" },
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the reply and reads back the platform message id", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ messages: [{ id: "wamid.out-9" }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await whatsappAdapter.sendOutbound(outbound, config);

    expect(result.platformMessageId).toBe("wamid.out-9");
    expect(result.deliveredAt).toBeInstanceOf(Date);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v20.0/PN_ID/messages");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer token-123",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      to: "66812345678",
      type: "text",
      text: { body: "Yes, we're open until 6pm." },
    });
  });

  it("throws OutboundDeliveryError when WhatsApp rejects the send", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":{"message":"invalid token"}}', { status: 401 })),
    );
    await expect(whatsappAdapter.sendOutbound(outbound, config)).rejects.toThrow(
      OutboundDeliveryError,
    );
  });

  it("throws when the channel has no access token", async () => {
    await expect(
      whatsappAdapter.sendOutbound(outbound, { phoneNumberId: "PN_ID" }),
    ).rejects.toThrow(/accessToken/);
  });

  it("throws when the channel has no phone number id", async () => {
    await expect(
      whatsappAdapter.sendOutbound(outbound, { accessToken: "token-123" }),
    ).rejects.toThrow(/phoneNumberId/);
  });

  it("throws on an attachment-only reply (text only for now)", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      whatsappAdapter.sendOutbound({ ...outbound, body: "   " }, config),
    ).rejects.toThrow(/text replies only/);
  });
});
