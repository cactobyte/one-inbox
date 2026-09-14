import { decryptCredentials } from "@/lib/channel-credentials";

import type { ChannelConfig } from "./adapter";

/** The columns `resolveChannelConfig` needs off a `channel` row. */
export type ChannelConfigSource = {
  config: unknown;
  credentialsEncrypted: string | null;
};

/**
 * The one place that reconstructs the flat config object adapters and
 * `lib/channels/verify.ts` expect: the channel's public `config` merged with
 * its decrypted secrets (M7). Every read path (inbound webhook, SSE stream,
 * agent reply) calls this instead of reading `channel.config` directly, so
 * no adapter needs to know credentials are stored encrypted at all.
 */
export function resolveChannelConfig(channel: ChannelConfigSource): ChannelConfig {
  const publicConfig = (channel.config ?? {}) as Record<string, unknown>;
  const credentials = decryptCredentials(channel.credentialsEncrypted);
  return { ...publicConfig, ...credentials };
}
