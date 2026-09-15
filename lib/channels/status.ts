import { eq } from "drizzle-orm";

import type { AppDb } from "@/db";
import { channel } from "@/db/schema";

/**
 * Per-tenant channel status (M8). Three independent facts, each a nullable
 * timestamp (plus one message) on `channel` — no event log, no status enum:
 *
 *  - `disabledAt`   — the owner paused this channel. Set/cleared by
 *    `lib/channel-settings.ts#setChannelEnabled`.
 *  - `lastInboundAt` — the last time a webhook for this channel verified and
 *    was processed. Bumped by the inbound route on every authentic request.
 *  - `lastError` / `lastErrorAt` — the most recent *outbound delivery*
 *    failure (e.g. a LINE access token that expired). Cleared the next time
 *    a send succeeds. Inbound verification failures do NOT set this — a
 *    stray bad request (or someone probing the URL) isn't evidence the
 *    channel's credentials are broken; only a send actually failing is.
 */

export function isChannelEnabled(channel: { disabledAt: Date | null }): boolean {
  return channel.disabledAt === null;
}

export async function recordInboundSuccess(
  db: AppDb,
  channelId: string,
): Promise<void> {
  await db
    .update(channel)
    .set({ lastInboundAt: new Date() })
    .where(eq(channel.id, channelId));
}

export async function recordOutboundSuccess(
  db: AppDb,
  channelId: string,
): Promise<void> {
  await db
    .update(channel)
    .set({ lastError: null, lastErrorAt: null })
    .where(eq(channel.id, channelId));
}

export async function recordOutboundError(
  db: AppDb,
  channelId: string,
  message: string,
): Promise<void> {
  await db
    .update(channel)
    .set({ lastError: message, lastErrorAt: new Date() })
    .where(eq(channel.id, channelId));
}
