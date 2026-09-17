import { createHmac, timingSafeEqual } from "node:crypto";

import type { WebhookAuth } from "../verify";

/**
 * Verify a WhatsApp Cloud API webhook request.
 *
 * Meta signs the raw request body with HMAC-SHA256 keyed by the app secret
 * and sends the hex digest, prefixed `sha256=`, in `x-hub-signature-256`. We
 * recompute it over the exact bytes we received and compare in constant time
 * — same shape as LINE's `x-line-signature`, different header and encoding.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks#step-2--validate-payload-signature
 */
export function verifyWhatsAppWebhook(
  auth: WebhookAuth,
  config: Record<string, unknown>,
): boolean {
  const secret = config.appSecret;
  if (typeof secret !== "string" || secret === "") return false;

  const provided = auth.header("x-hub-signature-256");
  if (!provided || !provided.startsWith("sha256=")) return false;

  const expected =
    "sha256=" +
    createHmac("sha256", secret).update(auth.rawBody, "utf8").digest("hex");

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
