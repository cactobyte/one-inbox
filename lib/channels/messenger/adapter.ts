import {
  type ChannelAdapter,
  type ChannelConfig,
  InvalidPayloadError,
  OutboundDeliveryError,
} from "../adapter";
import type { InboundMessage, SendResult } from "../message";

import type { MessengerConfig, MessengerMessaging, MessengerWebhookBody } from "./types";

/**
 * Messenger Platform adapter (CLAUDE.md milestone M12).
 *
 *  - `parseInbound` turns one webhook body (`{ entry: [{ messaging: [...] }] }`)
 *    into zero or more `InboundMessage`s — postbacks and delivery/read
 *    receipts on the same array have no `message` field and are skipped.
 *  - `sendOutbound` delivers an agent reply with the Send API.
 *
 * The webhook's `x-hub-signature-256` HMAC is checked before this adapter
 * runs, and the one-time GET handshake Meta does when a webhook URL is first
 * configured is handled separately — see `lib/channels/verify.ts` and
 * `lib/channels/handshake.ts`. Both are the exact same mechanism WhatsApp
 * uses (same Meta app), reused rather than reimplemented.
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One `messaging` entry → one `InboundMessage`, or `null` if it isn't an
 * inbound text message (a postback, a delivery receipt, an empty message).
 */
function normaliseMessaging(item: MessengerMessaging): InboundMessage | null {
  const senderId = item.sender?.id;
  if (typeof senderId !== "string" || senderId === "") return null;

  const mid = item.message?.mid;
  if (typeof mid !== "string" || mid === "") return null;

  const text = item.message?.text;
  if (typeof text !== "string" || text === "") {
    // Attachment-only messages (image/sticker/etc.) need a second call to
    // resolve the CDN URL — out of scope here, same deferral WhatsApp made
    // for media (backlog).
    return null;
  }

  const sentAt =
    typeof item.timestamp === "number" && Number.isFinite(item.timestamp)
      ? new Date(item.timestamp)
      : new Date();

  return {
    platformMessageId: mid,
    sentAt,
    body: text,
    attachments: [],
    contact: {
      // The webhook carries no profile info; resolving it needs a separate
      // Graph API call the parser shouldn't make (same deferral LINE made).
      platformId: senderId,
      displayName: "Facebook user",
      email: null,
      phone: null,
    },
    thread: {
      // A Messenger 1:1 thread is keyed by the sender's PSID — the same
      // value the Send API addresses as `recipient.id`.
      platformId: senderId,
    },
  };
}

export const messengerAdapter: ChannelAdapter = {
  parseInbound(payload: unknown): InboundMessage[] {
    if (!isObject(payload)) {
      throw new InvalidPayloadError("payload must be a JSON object");
    }
    const entries = (payload as MessengerWebhookBody).entry;
    if (entries === undefined) {
      throw new InvalidPayloadError('Messenger webhook body has no "entry"');
    }
    if (!Array.isArray(entries)) {
      throw new InvalidPayloadError('"entry" must be an array');
    }

    const messages: InboundMessage[] = [];
    for (const entry of entries) {
      if (!isObject(entry)) {
        throw new InvalidPayloadError("each entry must be an object");
      }
      const messaging = entry.messaging;
      if (!Array.isArray(messaging)) continue;

      for (const raw of messaging) {
        if (!isObject(raw)) continue;
        const normalised = normaliseMessaging(raw as MessengerMessaging);
        if (normalised) messages.push(normalised);
      }
    }
    return messages;
  },

  async sendOutbound(message, config: ChannelConfig): Promise<SendResult> {
    const { pageAccessToken } = config as MessengerConfig;
    if (typeof pageAccessToken !== "string" || pageAccessToken === "") {
      throw new OutboundDeliveryError(
        "Messenger channel config has no pageAccessToken",
      );
    }

    const to = message.thread.platformId;
    if (!to) {
      throw new OutboundDeliveryError(
        "Messenger cannot send into a thread with no platform id",
      );
    }

    const text = message.body.trim();
    if (text === "") {
      // M12 replies are text only; the reply path guarantees body-or-
      // attachment, so an empty body here means an attachment-only reply
      // (backlog, same limit LINE and WhatsApp had).
      throw new OutboundDeliveryError("Messenger M12 supports text replies only");
    }

    let response: Response;
    try {
      response = await fetch("https://graph.facebook.com/v20.0/me/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${pageAccessToken}`,
        },
        body: JSON.stringify({
          recipient: { id: to },
          message: { text },
        }),
      });
    } catch (cause) {
      throw new OutboundDeliveryError(
        `Messenger send request failed: ${(cause as Error).message}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new OutboundDeliveryError(
        `Messenger send rejected (${response.status}): ${detail}`.trim(),
      );
    }

    const result = (await response.json().catch(() => null)) as {
      message_id?: unknown;
    } | null;
    const sentId = result?.message_id;

    return {
      platformMessageId: typeof sentId === "string" ? sentId : null,
      deliveredAt: new Date(),
    };
  },
};
