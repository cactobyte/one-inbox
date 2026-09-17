/**
 * Meta's one-time webhook subscription handshake (WhatsApp Cloud API,
 * and Messenger/Instagram when they land): the platform GETs the callback
 * URL with `hub.mode=subscribe&hub.verify_token=...&hub.challenge=...` when
 * the webhook is configured in the App Dashboard, and expects the raw
 * challenge string echoed back if the token matches what the channel owner
 * set. This is a one-off transport concern, not message content, so — same
 * reasoning as `lib/channels/verify.ts` — it does not belong on the
 * `ChannelAdapter` interface.
 *
 * Not channel-type-specific: any channel can put a `verifyToken` in its
 * config, and a channel with none configured never matches (LINE's webhook
 * GET, for instance, always 403s here — LINE doesn't use this handshake).
 */
export function matchWebhookChallenge(
  params: { mode: string | null; token: string | null; challenge: string | null },
  config: Record<string, unknown>,
): string | null {
  if (params.mode !== "subscribe" || params.challenge === null) return null;

  const expected = config.verifyToken;
  if (typeof expected !== "string" || expected === "") return null;

  return params.token === expected ? params.challenge : null;
}
