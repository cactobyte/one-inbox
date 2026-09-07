import { eq } from "drizzle-orm";

import { db } from "@/db";
import { channel as channelTable } from "@/db/schema";
import { InvalidPayloadError } from "@/lib/channels/adapter";
import { getAdapter, UnknownChannelError } from "@/lib/channels/registry";
import { verifyInboundWebhook } from "@/lib/channels/verify";
import { corsPreflight, withCors } from "@/lib/cors";
import { ingestInbound, type IngestResult } from "@/lib/inbox/ingest";
import { jsonError, jsonOk } from "@/lib/http";

type RouteContext = { params: Promise<{ channelId: string }> };

/**
 * Inbound webhook for one channel. The `channelId` in the path is the entry
 * point; it resolves to the account. Authenticity is verified per channel
 * type by `lib/channels/verify.ts` — the widget's shared `x-channel-token`,
 * LINE's `x-line-signature` HMAC over the raw body.
 *
 * One delivery can carry several messages (LINE batches `events`); each is
 * ingested independently and reported in `results`.
 *
 * Idempotent: a message already seen reports `status: "duplicate"` and
 * writes nothing the second time.
 *
 * The widget calls this from whatever origin it's embedded on, so it needs
 * CORS (see lib/cors.ts) — a preflight OPTIONS handler and the header on
 * every response.
 */
export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}

export async function POST(request: Request, context: RouteContext) {
  const { channelId } = await context.params;

  const [channel] = await db
    .select()
    .from(channelTable)
    .where(eq(channelTable.id, channelId))
    .limit(1);

  if (!channel) {
    return withCors(jsonError("Unknown channel", 404, "channel_not_found"));
  }

  const config = (channel.config ?? {}) as Record<string, unknown>;
  const rawBody = await request.text();

  const authentic = verifyInboundWebhook(
    channel.type,
    { header: (name) => request.headers.get(name), rawBody },
    config,
  );
  if (!authentic) {
    return withCors(jsonError("Webhook verification failed", 401, "unauthorised"));
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return withCors(jsonError("Body is not valid JSON", 400, "invalid_json"));
  }

  let adapter;
  try {
    adapter = getAdapter(channel.type);
  } catch (error) {
    if (error instanceof UnknownChannelError) {
      return withCors(jsonError(error.message, 422, "channel_type_unsupported"));
    }
    throw error;
  }

  let inbound;
  try {
    inbound = adapter.parseInbound(payload, config);
  } catch (error) {
    if (error instanceof InvalidPayloadError) {
      return withCors(jsonError(error.message, 400, "invalid_payload"));
    }
    throw error;
  }

  const results: IngestResult[] = [];
  for (const message of inbound) {
    results.push(await ingestInbound(db, channel, message));
  }

  const created = results.some((r) => r.status === "created");
  // "accepted" covers a delivery with nothing to ingest — a LINE
  // follow/unfollow or verification ping. LINE only needs a 2xx.
  const status = results.length === 0 ? "accepted" : created ? "created" : "duplicate";

  return withCors(
    jsonOk(
      {
        status,
        results: results.map((r) => ({
          status: r.status,
          conversationId: r.conversationId,
          contactId: r.contactId,
          messageId: r.messageId,
        })),
      },
      created ? 201 : 200,
    ),
  );
}
