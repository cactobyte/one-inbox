import { timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { channel as channelTable } from "@/db/schema";
import { InvalidPayloadError } from "@/lib/channels/adapter";
import { getAdapter, UnknownChannelError } from "@/lib/channels/registry";
import { ingestInbound } from "@/lib/inbox/ingest";
import { jsonError, jsonOk } from "@/lib/http";

type RouteContext = { params: Promise<{ channelId: string }> };

function tokenMatches(provided: string | null, expected: unknown): boolean {
  if (typeof expected !== "string" || expected.length === 0) return false;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Inbound webhook for one channel. The `channelId` in the path is the entry
 * point; it resolves to the account. The `x-channel-token` header is checked
 * against `channel.config.inboundToken` (per-platform signature verification
 * is a later concern — see docs/decisions.md).
 *
 * Idempotent: the same payload twice returns 200 with `status: "duplicate"`
 * and writes nothing the second time.
 */
export async function POST(request: Request, context: RouteContext) {
  const { channelId } = await context.params;

  const [channel] = await db
    .select()
    .from(channelTable)
    .where(eq(channelTable.id, channelId))
    .limit(1);

  if (!channel) {
    return jsonError("Unknown channel", 404, "channel_not_found");
  }

  const config = (channel.config ?? {}) as Record<string, unknown>;
  if (!tokenMatches(request.headers.get("x-channel-token"), config.inboundToken)) {
    return jsonError("Invalid channel token", 401, "unauthorised");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Body is not valid JSON", 400, "invalid_json");
  }

  let adapter;
  try {
    adapter = getAdapter(channel.type);
  } catch (error) {
    if (error instanceof UnknownChannelError) {
      return jsonError(error.message, 422, "channel_type_unsupported");
    }
    throw error;
  }

  let inbound;
  try {
    inbound = adapter.parseInbound(payload, config);
  } catch (error) {
    if (error instanceof InvalidPayloadError) {
      return jsonError(error.message, 400, "invalid_payload");
    }
    throw error;
  }

  const result = await ingestInbound(db, channel, inbound);

  return jsonOk(
    {
      status: result.status,
      conversationId: result.conversationId,
      contactId: result.contactId,
      messageId: result.messageId,
    },
    result.status === "created" ? 201 : 200,
  );
}
