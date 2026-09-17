import {
  type ChannelAdapter,
  type ChannelConfig,
  InvalidPayloadError,
  OutboundDeliveryError,
} from "../adapter";
import type { InboundMessage, SendResult } from "../message";

import type {
  WhatsAppConfig,
  WhatsAppContact,
  WhatsAppMessage,
  WhatsAppWebhookBody,
} from "./types";

/**
 * WhatsApp Cloud API adapter (CLAUDE.md milestone M12).
 *
 *  - `parseInbound` turns one webhook body (`{ entry: [{ changes: [...] }] }`)
 *    into zero or more `InboundMessage`s — WhatsApp has no group-chat concept
 *    for business messaging, so unlike LINE there is no thread kind to skip.
 *  - `sendOutbound` delivers an agent reply with the Graph API send endpoint.
 *
 * The webhook's `x-hub-signature-256` HMAC is checked before this adapter
 * runs — see `lib/channels/verify.ts`. The separate one-time GET handshake
 * Meta does when a webhook URL is first configured is not part of this
 * adapter either — see `lib/channels/handshake.ts`.
 */

const GRAPH_API_VERSION = "v20.0";

/** Media messages carry no text; show the agent that something arrived. */
const PLACEHOLDER: Record<string, string> = {
  image: "[image]",
  video: "[video]",
  audio: "[audio]",
  document: "[file]",
  sticker: "[sticker]",
  location: "[location]",
  contacts: "[contact]",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bodyFor(message: WhatsAppMessage): string {
  if (message.type === "text") {
    const text = message.text?.body;
    if (typeof text === "string") return text;
  }
  const type = message.type ?? "message";
  return PLACEHOLDER[type] ?? `[${type}]`;
}

/**
 * One WhatsApp message object → one `InboundMessage`, or `null` if it's
 * missing the fields the model requires (no id, no sender).
 */
function normaliseMessage(
  message: WhatsAppMessage,
  contacts: WhatsAppContact[],
): InboundMessage | null {
  if (typeof message.id !== "string" || message.id === "") return null;
  if (typeof message.from !== "string" || message.from === "") return null;

  const seconds = Number(message.timestamp);
  const sentAt = Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();

  const name = contacts.find((c) => c.wa_id === message.from)?.profile?.name;

  return {
    platformMessageId: message.id,
    sentAt,
    body: bodyFor(message),
    // WhatsApp media needs a second authenticated call (GET the media id,
    // then the returned URL) plus somewhere to store the bytes — out of
    // scope here, same deferral LINE made (backlog).
    attachments: [],
    contact: {
      // `wa_id` is the customer's phone number, digits only, no leading `+`.
      platformId: message.from,
      displayName: typeof name === "string" && name !== "" ? name : "WhatsApp user",
      email: null,
      // Unlike LINE, the real phone number is already on the payload — no
      // extra profile-fetch call needed to get real contact data.
      phone: `+${message.from}`,
    },
    thread: {
      // 1:1 WhatsApp chat is keyed by the customer's number — the same value
      // an outbound send addresses as `to`.
      platformId: message.from,
    },
  };
}

export const whatsappAdapter: ChannelAdapter = {
  parseInbound(payload: unknown): InboundMessage[] {
    if (!isObject(payload)) {
      throw new InvalidPayloadError("payload must be a JSON object");
    }
    const entries = (payload as WhatsAppWebhookBody).entry;
    if (entries === undefined) {
      throw new InvalidPayloadError('WhatsApp webhook body has no "entry"');
    }
    if (!Array.isArray(entries)) {
      throw new InvalidPayloadError('"entry" must be an array');
    }

    const messages: InboundMessage[] = [];
    for (const entry of entries) {
      if (!isObject(entry)) {
        throw new InvalidPayloadError("each entry must be an object");
      }
      const changes = entry.changes;
      if (!Array.isArray(changes)) continue;

      for (const change of changes) {
        if (!isObject(change)) continue;
        const value = change.value;
        if (!isObject(value) || !Array.isArray(value.messages)) continue;

        const contacts = Array.isArray(value.contacts)
          ? (value.contacts as WhatsAppContact[])
          : [];

        for (const raw of value.messages) {
          if (!isObject(raw)) continue;
          const normalised = normaliseMessage(raw as WhatsAppMessage, contacts);
          if (normalised) messages.push(normalised);
        }
      }
    }
    return messages;
  },

  async sendOutbound(message, config: ChannelConfig): Promise<SendResult> {
    const { accessToken, phoneNumberId } = config as WhatsAppConfig;
    if (typeof accessToken !== "string" || accessToken === "") {
      throw new OutboundDeliveryError(
        "WhatsApp channel config has no accessToken",
      );
    }
    if (typeof phoneNumberId !== "string" || phoneNumberId === "") {
      throw new OutboundDeliveryError(
        "WhatsApp channel config has no phoneNumberId",
      );
    }

    const to = message.thread.platformId;
    if (!to) {
      throw new OutboundDeliveryError(
        "WhatsApp cannot send into a thread with no platform id",
      );
    }

    const text = message.body.trim();
    if (text === "") {
      // M12 replies are text only; the reply path guarantees body-or-
      // attachment, so an empty body here means an attachment-only reply
      // (backlog, same limit LINE M1 had).
      throw new OutboundDeliveryError("WhatsApp M12 supports text replies only");
    }

    let response: Response;
    try {
      response = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: text },
          }),
        },
      );
    } catch (cause) {
      throw new OutboundDeliveryError(
        `WhatsApp send request failed: ${(cause as Error).message}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new OutboundDeliveryError(
        `WhatsApp send rejected (${response.status}): ${detail}`.trim(),
      );
    }

    const result = (await response.json().catch(() => null)) as {
      messages?: { id?: unknown }[];
    } | null;
    const sentId = result?.messages?.[0]?.id;

    return {
      platformMessageId: typeof sentId === "string" ? sentId : null,
      deliveredAt: new Date(),
    };
  },
};
