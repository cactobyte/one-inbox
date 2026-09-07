import type {
  InboundMessage,
  OutboundMessage,
  SendResult,
} from "./message";

/**
 * A channel adapter does exactly two things (CLAUDE.md architecture rule 1):
 *
 *  1. `parseInbound` — turn a raw platform payload into normalised messages.
 *  2. `sendOutbound` — deliver an `OutboundMessage` to that platform.
 *
 * It holds no business logic, touches no database, and knows nothing about
 * conversations, contacts or assignment. Everything it needs about the
 * connected inbox (tokens, secrets, page ids) arrives in `config` — the
 * opaque `channel.config` JSON for this channel.
 *
 * Webhook authenticity (LINE's HMAC signature, Messenger's `X-Hub-Signature`)
 * is verified *before* this interface is reached — see `lib/channels/verify.ts`,
 * an endpoint strategy keyed on channel type. It is deliberately not a method
 * here: that keeps "exactly two things" true and keeps transport out of every
 * adapter (see docs/decisions.md, Foundations).
 *
 * Written to fit LINE, Messenger and WhatsApp adapters: there are no
 * website-specific concepts in this interface.
 */
export interface ChannelAdapter {
  /**
   * Parse and validate a raw inbound payload into zero or more normalised
   * messages. Synchronous and pure — no network, no clock beyond reading
   * timestamps out of the payload.
   *
   * Returns an array because a single webhook delivery can carry several
   * messages (LINE batches `events`, Messenger batches `entry[].messaging[]`).
   * Payload envelopes with nothing to ingest — a LINE follow/unfollow, an
   * event type the adapter does not handle — return `[]`, not an error.
   *
   * @throws {InvalidPayloadError} if the payload envelope itself is malformed
   *   (not the shape this platform sends at all).
   */
  parseInbound(payload: unknown, config: ChannelConfig): InboundMessage[];

  /**
   * Deliver a normalised outbound message to the platform. May call the
   * platform's API. Returns the platform's message id when it gives one.
   *
   * @throws {OutboundDeliveryError} if the platform rejects the message.
   */
  sendOutbound(
    message: OutboundMessage,
    config: ChannelConfig,
  ): Promise<SendResult>;
}

/** The opaque per-channel configuration blob (`channel.config`). */
export type ChannelConfig = Record<string, unknown>;

/** The payload could not be normalised. The caller should answer 400. */
export class InvalidPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPayloadError";
  }
}

/** The platform refused to accept an outbound message. */
export class OutboundDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundDeliveryError";
  }
}
