import type { WidgetConfig, WireAttachment } from "./types.js";

/**
 * Talks to the two endpoints the widget needs: the day 2 inbound endpoint
 * (send) and the day 3 SSE stream (receive). No other coupling to the app.
 */

export type SendInput = {
  messageId: string;
  visitorId: string;
  visitorName?: string;
  text: string;
  attachments?: WireAttachment[];
};

export type SendOutcome =
  | { ok: true; status: "created" | "duplicate" }
  | { ok: false; error: string };

/** POST a visitor message to the channel's inbound endpoint. */
export async function sendMessage(
  config: WidgetConfig,
  input: SendInput,
): Promise<SendOutcome> {
  try {
    const res = await fetch(
      `${config.apiBase}/api/channels/${config.channelId}/inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-channel-token": config.token,
        },
        body: JSON.stringify({
          messageId: input.messageId,
          visitorId: input.visitorId,
          visitorName: input.visitorName,
          text: input.text,
          attachments: input.attachments,
          sentAt: new Date().toISOString(),
        }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return { ok: false, error: body?.error?.message ?? `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { data: { status: "created" | "duplicate" } };
    return { ok: true, status: body.data.status };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

/**
 * Open the SSE stream for this visitor's conversation. Reconnect and
 * Last-Event-ID resume are native `EventSource` behaviour — the browser
 * remembers the id of the last event it saw and resends it as the
 * `Last-Event-ID` header on every reconnect attempt. We just have to give
 * the server something that honours that header (see
 * app/api/channels/[channelId]/stream/route.ts).
 */
export function connectStream(config: WidgetConfig, visitorId: string): EventSource {
  const url = new URL(`${config.apiBase}/api/channels/${config.channelId}/stream`);
  url.searchParams.set("visitorId", visitorId);
  url.searchParams.set("token", config.token);
  return new EventSource(url.toString());
}
