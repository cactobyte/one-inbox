/**
 * The subset of the Instagram Messaging webhook payload this adapter reads.
 * Full reference: https://developers.facebook.com/docs/messenger-platform/instagram
 *
 * Instagram DMs ride the same Messenger Platform webhook/Send API shape as
 * Facebook Messenger, just with `object: "instagram"` and IGSIDs (Instagram-
 * scoped user ids) in place of PSIDs — see `../messenger/types.ts`.
 */

export type InstagramMessage = {
  mid?: string;
  text?: string;
};

export type InstagramMessaging = {
  sender?: { id?: string };
  recipient?: { id?: string };
  /** Epoch milliseconds. */
  timestamp?: number;
  message?: InstagramMessage;
};

export type InstagramEntry = {
  id?: string;
  messaging?: InstagramMessaging[];
};

export type InstagramWebhookBody = {
  object?: string;
  entry?: InstagramEntry[];
};

/** What the adapter needs out of `channel.config` for Instagram. */
export type InstagramConfig = {
  /** Page access token for the Page connected to this IG account. */
  pageAccessToken?: unknown;
  /** The app secret — the HMAC key for inbound signature verification. */
  appSecret?: unknown;
  /** Shared token Meta echoes back during the one-time webhook handshake. */
  verifyToken?: unknown;
};
