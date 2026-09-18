/**
 * The subset of the Messenger Platform webhook payload this adapter reads.
 * Full reference: https://developers.facebook.com/docs/messenger-platform/webhooks
 *
 * A webhook request body is `{ object: "page", entry: [...] }`. Each entry
 * carries `messaging[]` — one item per event on that page, each with a
 * `sender`/`recipient` PSID pair and, for a text message, `message.text`.
 * Delivery/read receipts and postbacks arrive on the same array with no
 * `message` field and are not read here.
 */

export type MessengerMessage = {
  mid?: string;
  text?: string;
};

export type MessengerMessaging = {
  sender?: { id?: string };
  recipient?: { id?: string };
  /** Epoch milliseconds. */
  timestamp?: number;
  message?: MessengerMessage;
};

export type MessengerEntry = {
  id?: string;
  messaging?: MessengerMessaging[];
};

export type MessengerWebhookBody = {
  object?: string;
  entry?: MessengerEntry[];
};

/** What the adapter needs out of `channel.config` for Messenger. */
export type MessengerConfig = {
  /** Page access token — authorises outbound send calls. */
  pageAccessToken?: unknown;
  /** The app secret — the HMAC key for inbound signature verification. */
  appSecret?: unknown;
  /** Shared token Meta echoes back during the one-time webhook handshake. */
  verifyToken?: unknown;
};
