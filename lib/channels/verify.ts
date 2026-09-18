import type { ChannelType } from "@/db/schema";
import { tokenMatches } from "@/lib/channel-auth";

import { verifyLineWebhook } from "./line/verify";
import { verifyWhatsAppWebhook } from "./whatsapp/verify";

/**
 * Webhook authenticity, keyed on channel type.
 *
 * Every messaging platform authenticates its webhooks differently — the
 * website widget sends a shared `x-channel-token`, LINE signs the body with
 * HMAC-SHA256, Messenger uses `X-Hub-Signature-256`. That is transport, not
 * message content, so it does not belong on the `ChannelAdapter` interface
 * (which stays "exactly two things" — see docs/decisions.md, Foundations).
 *
 * This is the "endpoint strategy keyed on channel type" that the day-2
 * decision note anticipated: one registry, the same pattern as
 * `lib/channels/registry.ts`. A channel type with no entry here falls back to
 * the shared-token check, which is all the widget ever needed.
 */

/** What a verifier can read off the inbound request. */
export type WebhookAuth = {
  /** A request header value, or null. Case-insensitive name. */
  header(name: string): string | null;
  /** The exact request body bytes, as received, before JSON parsing. */
  rawBody: string;
};

type Verifier = (auth: WebhookAuth, config: Record<string, unknown>) => boolean;

const VERIFIERS: Partial<Record<ChannelType, Verifier>> = {
  line: verifyLineWebhook,
  // Messenger and Instagram are the same Meta app family as WhatsApp Cloud
  // API — identical `x-hub-signature-256` HMAC-SHA256-over-raw-body scheme,
  // so the one verifier is reused rather than reimplemented per channel.
  whatsapp: verifyWhatsAppWebhook,
  messenger: verifyWhatsAppWebhook,
  instagram: verifyWhatsAppWebhook,
};

/** The default for any channel without a platform-specific verifier. */
function verifySharedToken(
  auth: WebhookAuth,
  config: Record<string, unknown>,
): boolean {
  return tokenMatches(auth.header("x-channel-token"), config.inboundToken);
}

export function verifyInboundWebhook(
  type: ChannelType,
  auth: WebhookAuth,
  config: Record<string, unknown>,
): boolean {
  const verifier = VERIFIERS[type] ?? verifySharedToken;
  return verifier(auth, config);
}
