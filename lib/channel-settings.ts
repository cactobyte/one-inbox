import { desc, eq } from "drizzle-orm";

import type { AppDb } from "@/db";
import { channel, type AgentRole, type ChannelType } from "@/db/schema";
import { encryptCredentials } from "@/lib/channel-credentials";

/**
 * Settings/integrations (M7): the owner connects a channel's own credentials
 * through the UI instead of an env var or a seed script. Credentials are
 * encrypted before they ever reach the database (`lib/channel-credentials.ts`)
 * and this module never returns them back out — `listChannels` reports only
 * what is safe to display.
 */

export class ChannelSettingsError extends Error {
  constructor(
    readonly code: "not_owner" | "missing_fields",
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
    })
    .from(channel)
    .where(eq(channel.accountId, accountId))
    .orderBy(desc(channel.createdAt));
  return rows;
}

function requireOwner(role: AgentRole): void {
  if (role !== "owner") {
    throw new ChannelSettingsError(
      "not_owner",
      "Only the account owner can connect a channel.",
    );
  }
}

export type ConnectLineInput = {
  name: string;
  channelSecret: string;
  channelAccessToken: string;
};

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

  const name = input.name.trim();
  const channelSecret = input.channelSecret.trim();
  const channelAccessToken = input.channelAccessToken.trim();
  if (!name || !channelSecret || !channelAccessToken) {
    throw new ChannelSettingsError(
      "missing_fields",
      "Name, channel secret, and channel access token are all required.",
    );
  }

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
