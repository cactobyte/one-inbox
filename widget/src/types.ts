/**
 * Wire types for the widget. Deliberately duplicated here rather than
 * imported from the Next app's `lib/channels` — the widget has no
 * build-time coupling to the app, only an HTTP contract with it.
 */

export type WireAttachment = {
  kind: "image" | "video" | "audio" | "file";
  url: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
};

/** One message as the widget renders it, regardless of where it came from. */
export type WidgetMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  attachments: WireAttachment[];
  sentAt: string;
  /** Set for a message this widget sent itself, before the server confirms it. */
  pending?: boolean;
};

/** The shape the stream endpoint sends for each `message` SSE event. */
export type StreamMessageEvent = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  attachments: WireAttachment[];
  sentAt: string;
};

export type WidgetConfig = {
  channelId: string;
  token: string;
  apiBase: string;
};
