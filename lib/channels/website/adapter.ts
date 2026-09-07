import { type ChannelAdapter, InvalidPayloadError } from "../adapter";
import type {
  InboundMessage,
  NormalisedAttachment,
  SendResult,
} from "../message";

/**
 * The payload the website widget POSTs for each visitor message. The widget
 * itself is day 3; this is the contract it must meet.
 *
 * `messageId` and `visitorId` are generated client-side (UUIDs). `messageId`
 * is the idempotency key — the widget resends it on retry. For v1 a visitor
 * has exactly one thread, so the thread id is the visitor id (see
 * docs/backlog.md for multi-thread).
 */
export type WebsiteInboundPayload = {
  messageId: string;
  visitorId: string;
  visitorName?: string;
  visitorEmail?: string;
  text: string;
  attachments?: NormalisedAttachment[];
  sentAt?: string;
};

const ATTACHMENT_KINDS: ReadonlySet<string> = new Set([
  "image",
  "video",
  "audio",
  "file",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  source: Record<string, unknown>,
  key: string,
): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidPayloadError(`"${key}" must be a non-empty string`);
  }
  return value;
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new InvalidPayloadError(`"${key}" must be a string`);
  }
  return value;
}

function parseAttachments(value: unknown): NormalisedAttachment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new InvalidPayloadError(`"attachments" must be an array`);
  }
  return value.map((raw, i) => {
    if (!isObject(raw)) {
      throw new InvalidPayloadError(`attachments[${i}] must be an object`);
    }
    const kind = raw.kind;
    if (typeof kind !== "string" || !ATTACHMENT_KINDS.has(kind)) {
      throw new InvalidPayloadError(
        `attachments[${i}].kind must be one of ${[...ATTACHMENT_KINDS].join(", ")}`,
      );
    }
    if (typeof raw.url !== "string" || raw.url === "") {
      throw new InvalidPayloadError(`attachments[${i}].url must be a string`);
    }
    return {
      kind: kind as NormalisedAttachment["kind"],
      url: raw.url,
      name: typeof raw.name === "string" ? raw.name : undefined,
      mimeType: typeof raw.mimeType === "string" ? raw.mimeType : undefined,
      sizeBytes:
        typeof raw.sizeBytes === "number" ? raw.sizeBytes : undefined,
    };
  });
}

function parseSentAt(value: unknown): Date {
  if (value === undefined || value === null) return new Date();
  if (typeof value !== "string") {
    throw new InvalidPayloadError(`"sentAt" must be an ISO date string`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidPayloadError(`"sentAt" is not a valid date`);
  }
  return date;
}

export const websiteAdapter: ChannelAdapter = {
  parseInbound(payload: unknown): InboundMessage[] {
    if (!isObject(payload)) {
      throw new InvalidPayloadError("payload must be a JSON object");
    }

    const messageId = requireString(payload, "messageId");
    const visitorId = requireString(payload, "visitorId");
    const attachments = parseAttachments(payload.attachments);

    const text = payload.text;
    if (typeof text !== "string") {
      throw new InvalidPayloadError(`"text" must be a string`);
    }
    if (text.trim() === "" && attachments.length === 0) {
      throw new InvalidPayloadError("message has no text and no attachments");
    }

    const visitorName = optionalString(payload, "visitorName");
    const visitorEmail = optionalString(payload, "visitorEmail");

    // The widget POSTs exactly one message per request; the array is the
    // adapter contract, not a batch the widget ever sends.
    return [
      {
        platformMessageId: messageId,
        sentAt: parseSentAt(payload.sentAt),
        body: text,
        attachments,
        contact: {
          platformId: visitorId,
          displayName: visitorName?.trim() || "Website visitor",
          email: visitorEmail ?? null,
        },
        thread: {
          // v1: one visitor, one thread.
          platformId: visitorId,
        },
      },
    ];
  },

  // The website widget has no API to post into. An outbound message is
  // persisted by the core and the widget pulls it through the real-time
  // layer (day 3+). There is nothing to deliver here — just acknowledge.
  // (Signature intentionally takes no args; it still satisfies ChannelAdapter.)
  async sendOutbound(): Promise<SendResult> {
    return { platformMessageId: null, deliveredAt: new Date() };
  },
};
