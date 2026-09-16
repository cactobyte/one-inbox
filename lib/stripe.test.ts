import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBillingPortalSession,
  createCheckoutSession,
  StripeApiError,
  verifyStripeSignature,
} from "./stripe";

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_tests";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SECRET = "whsec_test_secret";

function sign(rawBody: string, secret: string, timestampSeconds: number): string {
  const sig = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest("hex");
  return `t=${timestampSeconds},v1=${sig}`;
}

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed, recent event", () => {
    const body = JSON.stringify({ id: "evt_1" });
    const now = 1_700_000_000_000;
    const header = sign(body, SECRET, Math.floor(now / 1000));
    expect(verifyStripeSignature(body, header, SECRET, now)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ id: "evt_1" });
    const now = 1_700_000_000_000;
    const header = sign(body, SECRET, Math.floor(now / 1000));
    expect(verifyStripeSignature(body + " ", header, SECRET, now)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const body = JSON.stringify({ id: "evt_1" });
    const now = 1_700_000_000_000;
    const header = sign(body, "wrong-secret", Math.floor(now / 1000));
    expect(verifyStripeSignature(body, header, SECRET, now)).toBe(false);
  });

  it("rejects a timestamp outside the tolerance window (replay protection)", () => {
    const body = JSON.stringify({ id: "evt_1" });
    const now = 1_700_000_000_000;
    const staleTimestamp = Math.floor(now / 1000) - 600; // 10 minutes old
    const header = sign(body, SECRET, staleTimestamp);
    expect(verifyStripeSignature(body, header, SECRET, now)).toBe(false);
  });

  it("accepts if any v1 matches when the header carries more than one (secret rotation)", () => {
    const body = JSON.stringify({ id: "evt_1" });
    const now = 1_700_000_000_000;
    const t = Math.floor(now / 1000);
    const goodSig = createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
    const header = `t=${t},v1=deadbeef,v1=${goodSig}`;
    expect(verifyStripeSignature(body, header, SECRET, now)).toBe(true);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyStripeSignature("{}", null, SECRET)).toBe(false);
    expect(verifyStripeSignature("{}", "garbage", SECRET)).toBe(false);
    expect(verifyStripeSignature("{}", "t=123", SECRET)).toBe(false);
  });
});

describe("createCheckoutSession", () => {
  it("posts form-encoded params and returns the checkout URL", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ url: "https://checkout.stripe.com/pay/cs_test_1" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCheckoutSession({
      priceId: "price_123",
      accountId: "acct_abc",
      customerEmail: "owner@example.com",
      successUrl: "https://app.example/settings/billing?checkout=success",
      cancelUrl: "https://app.example/settings/billing?checkout=canceled",
    });

    expect(result.url).toBe("https://checkout.stripe.com/pay/cs_test_1");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk_test_fake_key_for_tests",
    );
    const params = new URLSearchParams(init.body as string);
    expect(params.get("mode")).toBe("subscription");
    expect(params.get("line_items[0][price]")).toBe("price_123");
    expect(params.get("client_reference_id")).toBe("acct_abc");
    expect(params.get("customer_email")).toBe("owner@example.com");
    expect(params.get("customer")).toBeNull();
  });

  it("uses an existing customer id instead of an email when both would apply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const params = new URLSearchParams(init.body as string);
        expect(params.get("customer")).toBe("cus_existing");
        expect(params.get("customer_email")).toBeNull();
        return new Response(JSON.stringify({ url: "https://checkout.stripe.com/x" }), {
          status: 200,
        });
      }),
    );

    await createCheckoutSession({
      priceId: "price_123",
      accountId: "acct_abc",
      customerId: "cus_existing",
      customerEmail: "owner@example.com",
      successUrl: "https://app.example/ok",
      cancelUrl: "https://app.example/cancel",
    });
  });

  it("throws StripeApiError when Stripe rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "No such price" } }), {
            status: 400,
          }),
      ),
    );
    await expect(
      createCheckoutSession({
        priceId: "price_bad",
        accountId: "acct_abc",
        successUrl: "https://app.example/ok",
        cancelUrl: "https://app.example/cancel",
      }),
    ).rejects.toThrow(StripeApiError);
  });
});

describe("createBillingPortalSession", () => {
  it("posts the customer id and return url", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ url: "https://billing.stripe.com/p/session_1" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createBillingPortalSession({
      customerId: "cus_abc",
      returnUrl: "https://app.example/settings/billing",
    });

    expect(result.url).toBe("https://billing.stripe.com/p/session_1");
    const [, init] = fetchMock.mock.calls[0];
    const params = new URLSearchParams(init.body as string);
    expect(params.get("customer")).toBe("cus_abc");
    expect(params.get("return_url")).toBe("https://app.example/settings/billing");
  });
});
