import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe, over `fetch` against its REST API — no `stripe` npm dependency.
 * Same "REST over an SDK" choice already made for LINE and Resend: one
 * fewer dependency, and Stripe's API is plain form-encoded HTTP.
 */

const API_BASE = "https://api.stripe.com/v1";

export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigError";
  }
}

export class StripeApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeApiError";
  }
}

function secretKey(): string {
  const value = process.env.STRIPE_SECRET_KEY;
  if (!value) {
    throw new StripeConfigError("STRIPE_SECRET_KEY is not set. See .env.example.");
  }
  return value;
}

/** Stripe's form-encoding, including `line_items[0][price]`-style nesting. */
function toFormBody(params: Record<string, string | number | undefined>): string {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body.set(key, String(value));
  }
  return body.toString();
}

async function stripeRequest<T>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secretKey()}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: toFormBody(params),
    });
  } catch (cause) {
    throw new StripeApiError(`Stripe request failed: ${(cause as Error).message}`);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      `Stripe rejected the request (${response.status})`;
    throw new StripeApiError(message);
  }
  return body as T;
}

export type CheckoutSessionInput = {
  priceId: string;
  accountId: string;
  customerId?: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
};

/**
 * A hosted Stripe Checkout session in subscription mode. `client_reference_id`
 * carries our `accountId` so the webhook can find the account back —
 * Stripe's own recommended way to correlate a session to your own record
 * without needing a Stripe customer to exist first.
 */
export async function createCheckoutSession(
  input: CheckoutSessionInput,
): Promise<{ url: string }> {
  const result = await stripeRequest<{ url: string | null }>("/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": input.priceId,
    "line_items[0][quantity]": 1,
    client_reference_id: input.accountId,
    // Stripe rejects passing both — an existing customer takes priority.
    ...(input.customerId
      ? { customer: input.customerId }
      : input.customerEmail
        ? { customer_email: input.customerEmail }
        : {}),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
  if (!result.url) {
    throw new StripeApiError("Stripe did not return a checkout URL.");
  }
  return { url: result.url };
}

/**
 * The Stripe-hosted "manage my subscription" page — cancel, update card,
 * see invoices — none of which this app builds itself. Requires an existing
 * Stripe customer (i.e. the account has been through checkout at least once).
 */
export async function createBillingPortalSession(input: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const result = await stripeRequest<{ url: string }>("/billing_portal/sessions", {
    customer: input.customerId,
    return_url: input.returnUrl,
  });
  return { url: result.url };
}

const SIGNATURE_TOLERANCE_SECONDS = 300; // Stripe's own documented default.

/**
 * Verify a Stripe webhook's `Stripe-Signature` header:
 * `t=<unix seconds>,v1=<hex hmac>[,v1=<hex hmac> ...]`. The HMAC is over
 * `${timestamp}.${rawBody}`, keyed with the webhook's signing secret. A
 * rotated secret can briefly produce two `v1` values in one header — any
 * match is accepted. Also rejects a timestamp outside the tolerance window,
 * the same replay protection Stripe's own SDKs apply.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  now: number = Date.now(),
): boolean {
  if (!signatureHeader) return false;

  let timestamp: string | undefined;
  const candidateSignatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.split("=");
    if (key === "t") timestamp = value;
    if (key === "v1" && value) candidateSignatures.push(value);
  }
  if (!timestamp || candidateSignatures.length === 0) return false;

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) return false;
  if (Math.abs(now - timestampMs) > SIGNATURE_TOLERANCE_SECONDS * 1000) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const expectedBuf = Buffer.from(expected);

  return candidateSignatures.some((candidate) => {
    const candidateBuf = Buffer.from(candidate);
    return (
      candidateBuf.length === expectedBuf.length &&
      timingSafeEqual(candidateBuf, expectedBuf)
    );
  });
}
