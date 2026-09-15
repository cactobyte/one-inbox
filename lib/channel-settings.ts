import { and, desc, eq } from "drizzle-orm";

import type { AppDb } from "@/db";
import { channel, type AgentRole, type ChannelType } from "@/db/schema";
import { encryptCredentials } from "@/lib/channel-credentials";

/**
 * Settings/integrations (M7) and per-tenant channel management (M8): the
 * owner connects a channel's own credentials through the UI instead of an
 * env var or a seed script, and can later pause it or replace its
 * credentials. Credentials are encrypted before they ever reach the database
 * (`lib/channel-credentials.ts`) and this module never returns them back out
 * — `listChannels` reports only what is safe to display.
 */

export class ChannelSettingsError extends Error {
  constructor(
    readonly code: "not_owner" | "missing_fields" | "not_found" | "wrong_type",
    message: string,
  ) {
    super(message);
    this.name = "ChannelSettingsError";
  }
}

export type ChannelSummary = {
  id: string;
  name: string;
  type: ChannelType;
  createdAt: Date;
  enabled: boolean;
  lastInboundAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
};

/** Every channel on an account, newest first. Never includes credentials. */
export async function listChannels(
  db: AppDb,
  accountId: string,
): Promise<ChannelSummary[]> {
  const rows = await db
    .select({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      createdAt: channel.createdAt,
      disabledAt: channel.disabledAt,
      lastInboundAt: channel.lastInboundAt,
      lastError: channel.lastError,
      lastErrorAt: channel.lastErrorAt,
    })
    .from(channel)
    .where(eq(channel.accountId, accountId))
    .orderBy(desc(channel.createdAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    createdAt: r.createdAt,
    enabled: r.disabledAt === null,
    lastInboundAt: r.lastInboundAt,
    lastError: r.lastError,
    lastErrorAt: r.lastErrorAt,
  }));
}

function requireOwner(role: AgentRole): void {
  if (role !== "owner") {
    throw new ChannelSettingsError(
      "not_owner",
      "Only the account owner can manage channels.",
    );
  }
}

export type ConnectLineInput = {
  name: string;
  channelSecret: string;
  channelAccessToken: string;
};

function requireLineCredentials(input: ConnectLineInput): {
  name: string;
  channelSecret: string;
  channelAccessToken: string;
} {
  const name = input.name.trim();
  const channelSecret = input.channelSecret.trim();
  const channelAccessToken = input.channelAccessToken.trim();
  if (!name || !channelSecret || !channelAccessToken) {
    throw new ChannelSettingsError(
      "missing_fields",
      "Name, channel secret, and channel access token are all required.",
    );
  }
  return { name, channelSecret, channelAccessToken };
}

/**
 * Connect a LINE Official Account. `channelSecret` (webhook signature
 * verification, see `lib/channels/line/verify.ts`) and `channelAccessToken`
 * (push replies, see `lib/channels/line/adapter.ts`) are the only two fields
 * that adapter needs — both secret, so both go in `credentials_encrypted`.
 * The channel's public `config` is empty; LINE has nothing non-secret to put
 * there.
 */
export async function connectLineChannel(
  db: AppDb,
  actor: { accountId: string; role: AgentRole },
  input: ConnectLineInput,
): Promise<{ channelId: string }> {
  requireOwner(actor.role);
  const { name, channelSecret, channelAccessToken } = requireLineCredentials(input);
  const credentialsEncrypted = encryptCredentials({ channelSecret, channelAccessToken });

  const [row] = await db
    .insert(channel)
    .values({
      accountId: actor.accountId,
      type: "line",
      name,
      config: {},
      credentialsEncrypted,
    })
    .returning({ id: channel.id });

  return { channelId: row.id };
}

async function findOwnedChannel(
  db: AppDb,
  accountId: string,
  channelId: string,
): Promise<{ id: string; type: ChannelType }> {
  const [row] = await db
    .select({ id: channel.id, type: channel.type })
    .from(channel)
    .where(and(eq(channel.id, channelId), eq(channel.accountId, accountId)))
    .limit(1);
  if (!row) {
    throw new ChannelSettingsError("not_found", "Channel not found.");
  }
  return row;
}

/**
 * Pause or resume a channel (M8). Disabled means: the inbound webhook
 * refuses new messages, and agent replies through it are blocked
 * (`lib/inbox/reply.ts`) — see `lib/channels/status.ts`. Existing
 * conversations and their history are untouched either way.
 */
export async function setChannelEnabled(
  db: AppDb,
  actor: { accountId: string; role: AgentRole },
  channelId: string,
  enabled: boolean,
): Promise<void> {
  requireOwner(actor.role);
  await findOwnedChannel(db, actor.accountId, channelId);

  await db
    .update(channel)
    .set({ disabledAt: enabled ? null : new Date(), updatedAt: new Date() })
    .where(eq(channel.id, channelId));
}

export type ReconnectLineInput = {
  channelSecret: string;
  channelAccessToken: string;
};

/**
 * Replace a LINE channel's stored credentials — "reconnect on credential
 * failure/expiry" (M8 roadmap). Does not touch `disabledAt`: reconnecting
 * and re-enabling are separate, deliberate actions, so a channel someone
 * paused stays paused until they choose to resume it too.
 */
export async function reconnectLineChannel(
  db: AppDb,
  actor: { accountId: string; role: AgentRole },
  channelId: string,
  input: ReconnectLineInput,
): Promise<void> {
  requireOwner(actor.role);
  const existing = await findOwnedChannel(db, actor.accountId, channelId);
  if (existing.type !== "line") {
    throw new ChannelSettingsError(
      "wrong_type",
      "This isn't a LINE channel.",
    );
  }

  const channelSecret = input.channelSecret.trim();
  const channelAccessToken = input.channelAccessToken.trim();
  if (!channelSecret || !channelAccessToken) {
    throw new ChannelSettingsError(
      "missing_fields",
      "Channel secret and channel access token are both required.",
    );
  }

  const credentialsEncrypted = encryptCredentials({ channelSecret, channelAccessToken });
  await db
    .update(channel)
    .set({ credentialsEncrypted, updatedAt: new Date() })
    .where(eq(channel.id, channelId));
}
