/**
 * The normalised message model that channel adapters produce and consume.
 *
 * Nothing in here names a channel. Once a payload has been through an
 * adapter, the rest of the system — inbox, CRM, automation, analytics —
 * works with these shapes and never learns where the message came from
 * (CLAUDE.md architecture rule 2).
 */

export type NormalisedAttachment = {
  kind: "image" | "video" | "audio" | "file";
  url: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
};

/**
 * A message arriving from a platform, normalised.
 *
 * `contact.platformId` and `thread.platformId` are the stable identifiers the
 * source platform uses for the person and the thread. The core uses them to
 * find-or-create the `contact` and `conversation` rows idempotently; it does
 * not interpret them.
 */
export type InboundMessage = {
  /** The platform's own id for this message. The idempotency key. */
  platformMessageId: string;
  /** When the platform says the message was sent. */
  sentAt: Date;
  body: string;
  attachments: NormalisedAttachment[];
  contact: {
    platformId: string;
    displayName: string;
    email?: string | null;
    phone?: string | null;
  };
  thread: {
    platformId: string;
  };
};

/**
 * A message to deliver to a platform, normalised. Built by the core from an
 * agent's reply; handed to the adapter's `sendOutbound`.
 */
export type OutboundMessage = {
  body: string;
  attachments: NormalisedAttachment[];
  thread: {
    /** The platform thread to deliver into. Null for a brand-new thread. */
    platformId: string | null;
  };
};

/** What an adapter reports back after handing a message to the platform. */
export type SendResult = {
  /** The platform's id for the delivered message, if it returns one. */
  platformMessageId: string | null;
  deliveredAt: Date;
};
