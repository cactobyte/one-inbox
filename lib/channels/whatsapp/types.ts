/**
 * The subset of the WhatsApp Cloud API webhook payload this adapter reads.
 * Full reference: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
 *
 * A webhook request body is `{ object, entry: [...] }`. Each entry carries
 * `changes[]`; the `value` of a "messages" change carries the actual inbound
 * messages plus a `contacts[]` array keyed by `wa_id` (WhatsApp's id for the
 * customer, their phone number in international format with no leading `+`)
 * that supplies the sender's display name. `value.statuses[]` (delivery/read
 * receipts for our own outbound sends) is a separate, unrelated array on the
 * same `value` object — not read here.
 */

export type WhatsAppContact = {
  wa_id?: string;
  profile?: { name?: string };
};

export type WhatsAppMessage = {
  from?: string;
  id?: string;
  /** Unix seconds, as a string — not milliseconds. */
  timestamp?: string;
  type?: string;
  text?: { body?: string };
};

export type WhatsAppValue = {
  messaging_product?: string;
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: unknown[];
};

export type WhatsAppChange = {
  field?: string;
  value?: WhatsAppValue;
};

export type WhatsAppEntry = {
  id?: string;
  changes?: WhatsAppChange[];
};

export type WhatsAppWebhookBody = {
  object?: string;
  entry?: WhatsAppEntry[];
};

/** What the adapter needs out of `channel.config` for WhatsApp. */
export type WhatsAppConfig = {
  /** Routes an outbound send to the right sending number. Not secret. */
  phoneNumberId?: unknown;
  /** Long-lived system-user access token — authorises outbound send calls. */
  accessToken?: unknown;
  /** The app secret — the HMAC key for inbound signature verification. */
  appSecret?: unknown;
  /** Shared token Meta echoes back during the one-time webhook handshake. */
  verifyToken?: unknown;
};
