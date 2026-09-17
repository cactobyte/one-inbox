import { eq } from "drizzle-orm";

import { db } from "@/db";
import { channel as channelTable } from "@/db/schema";
import { InvalidPayloadError } from "@/lib/channels/adapter";
import { resolveChannelConfig } from "@/lib/channels/config";
import { matchWebhookChallenge } from "@/lib/channels/handshake";
import { getAdapter, UnknownChannelError } from "@/lib/channels/registry";
import { isChannelEnabled, recordInboundSuccess } from "@/lib/channels/status";
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
 *
 * GET is Meta's one-time webhook subscription handshake (WhatsApp Cloud
 * API) — see lib/channels/handshake.ts. It is not gated on the channel being
 * enabled: verifying a webhook URL in the App Dashboard is a setup step that
 * should work even for a channel an owner hasn't enabled yet.
 */
export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}

export async function GET(request: Request, context: RouteContext) {
  const { channelId } = await context.params;

  const [channel] = await db
    .select()
    .from(channelTable)
    .where(eq(channelTable.id, channelId))
    .limit(1);

  if (!channel) {
    return withCors(jsonError("Unknown channel", 404, "channel_not_found"));
  }

  const config = resolveChannelConfig(channel);
  const url = new URL(request.url);
  const challenge = matchWebhookChallenge(
    {
      mode: url.searchParams.get("hub.mode"),
      token: url.searchParams.get("hub.verify_token"),
      challenge: url.searchParams.get("hub.challenge"),
    },
    config,
  );

  if (challenge === null) {
    return withCors(jsonError("Verification failed", 403, "handshake_failed"));
  }

  // Meta requires the raw challenge string as the body, not our usual JSON
  // envelope — this is Meta's protocol, not our API (CLAUDE.md rule 4 is
  // about the endpoints we design, not a third party's fixed contract).
  return withCors(new Response(challenge, { status: 200 }));
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

  if (!isChannelEnabled(channel)) {
    return withCors(jsonError("This channel is disabled", 403, "channel_disabled"));
  }

  const config = resolveChannelConfig(channel);
  const rawBody = await request.text();

  const authentic = verifyInboundWebhook(
    channel.type,
    { header: (name) => request.headers.get(name), rawBody },
    config,
  );
  if (!authentic) {
    return withCors(jsonError("Webhook verification failed", 401, "unauthorised"));
  }

  // Authentic means the credentials on file actually work — the "is this
  // channel connected?" signal M8's status display uses. A parse/payload
  // error after this point doesn't undo that.
  await recordInboundSuccess(db, channel.id);

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
