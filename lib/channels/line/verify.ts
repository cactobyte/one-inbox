import { createHmac, timingSafeEqual } from "node:crypto";

import type { WebhookAuth } from "../verify";

/**
 * Verify a LINE webhook request.
 *
 * LINE signs the raw request body with HMAC-SHA256 keyed by the channel
 * secret and sends the base64 digest in `x-line-signature`. We recompute it
 * over the exact bytes we received and compare in constant time.
 * https://developers.line.biz/en/reference/messaging-api/#signature-validation
 */
export function verifyLineWebhook(
  auth: WebhookAuth,
  config: Record<string, unknown>,
): boolean {
  const secret = config.channelSecret;
  if (typeof secret !== "string" || secret === "") return false;

  const provided = auth.header("x-line-signature");
  if (!provided) return false;

  const expected = createHmac("sha256", secret)
    .update(auth.rawBody, "utf8")
    .digest("base64");

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
