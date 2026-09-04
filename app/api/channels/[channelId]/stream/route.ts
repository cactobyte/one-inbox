import { eq } from "drizzle-orm";

import { db } from "@/db";
import { channel as channelTable } from "@/db/schema";
import { tokenMatches } from "@/lib/channel-auth";
import { corsPreflight, withCors } from "@/lib/cors";
import { jsonError } from "@/lib/http";
import { encodeCursor, type Cursor } from "@/lib/inbox/cursor";
import { fetchMessagesSince, findConversationByThread } from "@/lib/inbox/stream";

// Polling, not LISTEN/NOTIFY or a queue — CLAUDE.md rules out new infra, and
// this is what "pick SSE" already committed to (docs/decisions.md).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ channelId: string }> };

const POLL_INTERVAL_MS = 1500;
// Vercel functions have a max execution time; end the stream cleanly before
// hitting it rather than being killed mid-response. EventSource reconnects
// on its own (with Last-Event-ID), so a periodic clean close is invisible
// to the widget beyond a brief gap — the same mechanism that recovers from
// a real network drop recovers from this too.
const MAX_STREAM_MS = 5 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sseChunk(event: string, data: unknown, id?: string): string {
  let chunk = "";
  if (id) chunk += `id: ${id}\n`;
  chunk += `event: ${event}\n`;
  chunk += `data: ${JSON.stringify(data)}\n\n`;
  return chunk;
}

export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}

/**
 * SSE stream of a widget visitor's conversation. `?visitorId=` and
 * `?token=` are query params, not headers — `EventSource` cannot set
 * custom request headers, so the same public per-channel token used on the
 * inbound endpoint travels in the URL here instead.
 *
 * Resume: the browser's `EventSource` remembers the `id:` of the last event
 * it processed and resends it as a `Last-Event-ID` request header on every
 * reconnect — this handler reads that header and resumes from exactly
 * there via `fetchMessagesSince` (lib/inbox/stream.ts). No reconnect logic
 * is needed on the client; it's native `EventSource` behaviour.
 */
export async function GET(request: Request, context: RouteContext) {
  const { channelId } = await context.params;
  const url = new URL(request.url);
  const visitorId = url.searchParams.get("visitorId");
  const token = url.searchParams.get("token");

  const [channel] = await db
    .select()
    .from(channelTable)
    .where(eq(channelTable.id, channelId))
    .limit(1);

  if (!channel) {
    return withCors(jsonError("Unknown channel", 404, "channel_not_found"));
  }

  const config = (channel.config ?? {}) as Record<string, unknown>;
  if (!tokenMatches(token, config.inboundToken)) {
    return withCors(jsonError("Invalid channel token", 401, "unauthorised"));
  }
  if (!visitorId) {
    return withCors(jsonError('"visitorId" is required', 400, "invalid_request"));
  }

  const encoder = new TextEncoder();
  let cursor: string | null = request.headers.get("last-event-id");
  let stopped = false;
  request.signal.addEventListener("abort", () => {
    stopped = true;
  });

  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now();

      while (!stopped && Date.now() - startedAt < MAX_STREAM_MS) {
        try {
          const conversation = await findConversationByThread(
            db,
            channelId,
            visitorId,
          );
          if (conversation) {
            const { messages, nextCursor } = await fetchMessagesSince(
              db,
              conversation.id,
              cursor,
            );
            for (const m of messages) {
              const rowCursor: Cursor = { createdAt: m.createdAt, id: m.id };
              controller.enqueue(
                encoder.encode(
                  sseChunk(
                    "message",
                    {
                      // Prefer the sender's own id (platformMessageId) so
                      // the widget's optimistic bubble for its own message
                      // reconciles instead of duplicating; only an agent
                      // reply (no platformMessageId) falls back to the row
                      // id, and the widget never had a pending copy of that
                      // to reconcile against anyway.
                      id: m.platformMessageId ?? m.id,
                      direction: m.direction,
                      body: m.body,
                      attachments: m.attachments,
                      sentAt: m.sentAt.toISOString(),
                    },
                    encodeCursor(rowCursor),
                  ),
                ),
              );
            }
            cursor = nextCursor;
          }
        } catch (error) {
          // A transient DB hiccup shouldn't kill the stream; log and retry
          // on the next tick rather than tearing the connection down.
          console.error("[stream] poll failed", error);
        }

        if (stopped) break;
        controller.enqueue(encoder.encode(": ping\n\n")); // heartbeat, no id/event
        await sleep(POLL_INTERVAL_MS);
      }
      try {
        controller.close();
      } catch {
        // Already closed by cancel().
      }
    },
    cancel() {
      stopped = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
      "x-accel-buffering": "no",
    },
  });
}
