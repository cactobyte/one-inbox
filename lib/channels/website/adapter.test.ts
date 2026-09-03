import { describe, expect, it } from "vitest";

import { InvalidPayloadError } from "../adapter";
import { websiteAdapter } from "./adapter";

const base = {
  messageId: "m-1",
  visitorId: "v-1",
  text: "Hello there",
};

describe("websiteAdapter.parseInbound", () => {
  it("normalises a well-formed payload", () => {
    const msg = websiteAdapter.parseInbound(
      {
        ...base,
        visitorName: "  Nok  ",
        visitorEmail: "nok@example.com",
        sentAt: "2026-09-03T10:00:00.000Z",
      },
      {},
    );

    expect(msg.platformMessageId).toBe("m-1");
    expect(msg.body).toBe("Hello there");
    expect(msg.contact).toEqual({
      platformId: "v-1",
      displayName: "Nok",
      email: "nok@example.com",
    });
    expect(msg.thread).toEqual({ platformId: "v-1" });
    expect(msg.sentAt.toISOString()).toBe("2026-09-03T10:00:00.000Z");
    expect(msg.attachments).toEqual([]);
  });

  it("defaults the display name and sentAt", () => {
    const before = Date.now();
    const msg = websiteAdapter.parseInbound(base, {});
    expect(msg.contact.displayName).toBe("Website visitor");
    expect(msg.contact.email).toBeNull();
    expect(msg.sentAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("uses the visitor id as the thread id (one thread per visitor)", () => {
    const msg = websiteAdapter.parseInbound({ ...base, visitorId: "abc" }, {});
    expect(msg.thread.platformId).toBe("abc");
    expect(msg.contact.platformId).toBe("abc");
  });

  it("rejects a non-object payload", () => {
    expect(() => websiteAdapter.parseInbound("nope", {})).toThrow(
      InvalidPayloadError,
    );
  });

  it("rejects a missing visitor id", () => {
    expect(() =>
      websiteAdapter.parseInbound(
        { messageId: base.messageId, text: base.text },
        {},
      ),
    ).toThrow(/visitorId/);
  });

  it("rejects a message with neither text nor attachments", () => {
    expect(() =>
      websiteAdapter.parseInbound({ ...base, text: "   " }, {}),
    ).toThrow(/no text and no attachments/);
  });

  it("accepts an attachment-only message", () => {
    const msg = websiteAdapter.parseInbound(
      {
        ...base,
        text: "",
        attachments: [{ kind: "image", url: "https://cdn.example/x.png" }],
      },
      {},
    );
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].kind).toBe("image");
  });

  it("rejects an unknown attachment kind", () => {
    expect(() =>
      websiteAdapter.parseInbound(
        {
          ...base,
          attachments: [{ kind: "hologram", url: "https://x" }],
        },
        {},
      ),
    ).toThrow(InvalidPayloadError);
  });

  it("rejects an unparseable sentAt", () => {
    expect(() =>
      websiteAdapter.parseInbound({ ...base, sentAt: "last tuesday" }, {}),
    ).toThrow(/valid date/);
  });
});

describe("websiteAdapter.sendOutbound", () => {
  it("acknowledges without a platform id (the widget pulls messages)", async () => {
    const result = await websiteAdapter.sendOutbound(
      { body: "Hi", attachments: [], thread: { platformId: "v-1" } },
      {},
    );
    expect(result.platformMessageId).toBeNull();
    expect(result.deliveredAt).toBeInstanceOf(Date);
  });
});
