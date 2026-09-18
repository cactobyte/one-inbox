import {
  type ChannelAdapter,
  type ChannelConfig,
  InvalidPayloadError,
  OutboundDeliveryError,
} from "../adapter";
import type { InboundMessage, SendResult } from "../message";

import type { InstagramConfig, InstagramMessaging, InstagramWebhookBody } from "./types";

/**
 * Instagram Messaging adapter (CLAUDE.md milestone M12).
 *
 * Same webhook/Send API shape as Messenger (`../messenger/adapter.ts`) —
 * Instagram DMs run on the same Messenger Platform, just IGSIDs instead of
 * PSIDs and `object: "instagram"`. Kept as its own adapter, not a shared
 * function, because it's a distinct `ChannelType`/`channel` row with its own
 * config and its own future divergence (story replies, IG-specific message
 * types) — same reasoning LINE and WhatsApp each got their own adapter
 * despite both being webhook-plus-push.
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseMessaging(item: InstagramMessaging): InboundMessage | null {
  const senderId = item.sender?.id;
  if (typeof senderId !== "string" || senderId === "") return null;

  const mid = item.message?.mid;
  if (typeof mid !== "string" || mid === "") return null;

  const text = item.message?.text;
  if (typeof text !== "string" || text === "") {
    // Attachment-only DMs (image/story-reply/etc.) need a second call to
    // resolve the CDN URL — out of scope here (backlog).
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
      displayName: "Instagram user",
      email: null,
      phone: null,
    },
    thread: {
      platformId: senderId,
    },
  };
}

export const instagramAdapter: ChannelAdapter = {
  parseInbound(payload: unknown): InboundMessage[] {
    if (!isObject(payload)) {
      throw new InvalidPayloadError("payload must be a JSON object");
    }
    const entries = (payload as InstagramWebhookBody).entry;
    if (entries === undefined) {
      throw new InvalidPayloadError('Instagram webhook body has no "entry"');
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
        const normalised = normaliseMessaging(raw as InstagramMessaging);
        if (normalised) messages.push(normalised);
      }
    }
    return messages;
  },

  async sendOutbound(message, config: ChannelConfig): Promise<SendResult> {
    const { pageAccessToken } = config as InstagramConfig;
    if (typeof pageAccessToken !== "string" || pageAccessToken === "") {
      throw new OutboundDeliveryError(
        "Instagram channel config has no pageAccessToken",
      );
    }

    const to = message.thread.platformId;
    if (!to) {
      throw new OutboundDeliveryError(
        "Instagram cannot send into a thread with no platform id",
      );
    }

    const text = message.body.trim();
    if (text === "") {
      throw new OutboundDeliveryError("Instagram M12 supports text replies only");
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
        `Instagram send request failed: ${(cause as Error).message}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new OutboundDeliveryError(
        `Instagram send rejected (${response.status}): ${detail}`.trim(),
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
