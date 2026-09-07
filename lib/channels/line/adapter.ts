import {
  type ChannelAdapter,
  type ChannelConfig,
  InvalidPayloadError,
  OutboundDeliveryError,
} from "../adapter";
import type { InboundMessage, SendResult } from "../message";

import type { LineEvent, LineMessage, LineWebhookBody } from "./types";

/**
 * LINE Messaging API adapter (CLAUDE.md milestone M1).
 *
 *  - `parseInbound` turns one webhook body (`{ events: [...] }`) into zero or
 *    more `InboundMessage`s — one per text/media message from a 1:1 user
 *    chat. Follow/unfollow/postback/join events and group/room messages are
 *    skipped (returned as no message), not errors.
 *  - `sendOutbound` delivers an agent reply with the push endpoint.
 *
 * The webhook's `x-line-signature` HMAC is checked before this adapter runs —
 * see `lib/channels/verify.ts`.
 */

const PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

/** Media messages carry no text; show the agent that something arrived. */
const PLACEHOLDER: Record<string, string> = {
  image: "[image]",
  video: "[video]",
  audio: "[audio]",
  file: "[file]",
  location: "[location]",
  sticker: "[sticker]",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bodyFor(message: LineMessage): string {
  if (message.type === "text") return message.text;
  return PLACEHOLDER[message.type] ?? `[${message.type}]`;
}

/**
 * One LINE event → one `InboundMessage`, or `null` if it is not an inbound
 * message this adapter ingests (wrong event type, a group/room thread, or a
 * malformed message object).
 */
function normaliseEvent(event: LineEvent): InboundMessage | null {
  if (event.type !== "message" || !event.message) return null;

  // M1 handles 1:1 user chats — the shape a LINE Official Account uses for
  // customer messaging. Group/room threads need different push semantics
  // (backlog).
  const source = event.source;
  if (!source || source.type !== "user" || !source.userId) return null;

  const message = event.message;
  if (typeof message.id !== "string" || message.id === "") return null;

  const sentAt =
    typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
      ? new Date(event.timestamp)
      : new Date();

  return {
    platformMessageId: message.id,
    sentAt,
    body: bodyFor(message),
    // LINE media needs a second authenticated call to the content endpoint
    // plus somewhere to store the bytes — out of M1 scope (backlog).
    attachments: [],
    contact: {
      // The webhook does not include the display name; enriching it from the
      // profile API is a network call and belongs outside a pure parse
      // (backlog). "LINE user" until then.
      platformId: source.userId,
      displayName: "LINE user",
      email: null,
      phone: null,
    },
    thread: {
      // A 1:1 LINE chat is keyed by the user id — the same value push
      // delivers `to`.
      platformId: source.userId,
    },
  };
}

export const lineAdapter: ChannelAdapter = {
  parseInbound(payload: unknown): InboundMessage[] {
    if (!isObject(payload)) {
      throw new InvalidPayloadError("payload must be a JSON object");
    }
    const events = (payload as LineWebhookBody).events;
    if (events === undefined) {
      throw new InvalidPayloadError('LINE webhook body has no "events"');
    }
    if (!Array.isArray(events)) {
      throw new InvalidPayloadError('"events" must be an array');
    }

    const messages: InboundMessage[] = [];
    for (const event of events) {
      if (!isObject(event)) {
        throw new InvalidPayloadError("each event must be an object");
      }
      const normalised = normaliseEvent(event as LineEvent);
      if (normalised) messages.push(normalised);
    }
    return messages;
  },

  async sendOutbound(message, config: ChannelConfig): Promise<SendResult> {
    const token = (config as { channelAccessToken?: unknown }).channelAccessToken;
    if (typeof token !== "string" || token === "") {
      throw new OutboundDeliveryError(
        "LINE channel config has no channelAccessToken",
      );
    }

    const to = message.thread.platformId;
    if (!to) {
      throw new OutboundDeliveryError(
        "LINE cannot push into a thread with no platform id",
      );
    }

    const text = message.body.trim();
    if (text === "") {
      // M1 replies are text only; the reply path guarantees body-or-attachment,
      // so an empty body here means an attachment-only reply (backlog).
      throw new OutboundDeliveryError("LINE M1 supports text replies only");
    }

    let response: Response;
    try {
      response = await fetch(PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
      });
    } catch (cause) {
      throw new OutboundDeliveryError(
        `LINE push request failed: ${(cause as Error).message}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new OutboundDeliveryError(
        `LINE push rejected (${response.status}): ${detail}`.trim(),
      );
    }

    // Recent LINE responses include `sentMessages: [{ id, quoteToken }]`.
    // Older ones return `{}` — a null id is valid (the model allows it).
    const result = (await response.json().catch(() => null)) as {
      sentMessages?: { id?: unknown }[];
    } | null;
    const sentId = result?.sentMessages?.[0]?.id;

    return {
      platformMessageId: typeof sentId === "string" ? sentId : null,
      deliveredAt: new Date(),
    };
  },
};
