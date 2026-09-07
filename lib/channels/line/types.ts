/**
 * The subset of the LINE Messaging API webhook payload this adapter reads.
 * Full reference: https://developers.line.biz/en/reference/messaging-api/#webhooks
 *
 * A webhook request body is `{ destination, events: [...] }`. `events` can be
 * empty (LINE sends a verification ping) or carry several events at once.
 */

export type LineSource =
  | { type: "user"; userId: string }
  | { type: "group"; groupId: string; userId?: string }
  | { type: "room"; roomId: string; userId?: string };

export type LineMessage =
  | { type: "text"; id: string; text: string }
  | { type: "image" | "video" | "audio" | "file" | "location" | "sticker"; id: string };

export type LineEvent = {
  type: string;
  timestamp?: number;
  source?: LineSource;
  message?: LineMessage;
  deliveryContext?: { isRedelivery?: boolean };
};

export type LineWebhookBody = {
  destination?: string;
  events?: LineEvent[];
};

/** What the adapter needs out of `channel.config` for LINE. */
export type LineConfig = {
  /** Long-lived channel access token — authorises outbound push calls. */
  channelAccessToken?: unknown;
  /** Channel secret — the HMAC key for inbound signature verification. */
  channelSecret?: unknown;
};
