import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { account } from "@/db/schema";
import { makeAccount, makeTestDb, type TestDb } from "@/test/db";

import {
  applyCheckoutCompleted,
  applySubscriptionUpdate,
  getBillingStatus,
  startBillingPortal,
  startCheckout,
} from "./billing";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.STRIPE_PRICE_ID = "price_pro";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STRIPE_PRICE_ID;
});

describe("getBillingStatus", () => {
  it("defaults to free with no Stripe customer for a fresh account", async () => {
    const accountId = await makeAccount(db);
    expect(await getBillingStatus(appDb, accountId)).toEqual({
      plan: "free",
      subscriptionStatus: null,
      hasStripeCustomer: false,
    });
  });
});

describe("startCheckout", () => {
  it("an owner starting checkout gets Stripe's URL, with the account id as client_reference_id", async () => {
    const accountId = await makeAccount(db);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const params = new URLSearchParams(init.body as string);
        expect(params.get("client_reference_id")).toBe(accountId);
        expect(params.get("line_items[0][price]")).toBe("price_pro");
        return new Response(JSON.stringify({ url: "https://checkout.stripe.com/x" }), {
          status: 200,
        });
      }),
    );

    const result = await startCheckout(
      appDb,
      { accountId, role: "owner" },
      {
        ownerEmail: "owner@example.com",
        successUrl: "https://app.example/ok",
        cancelUrl: "https://app.example/cancel",
      },
    );
    expect(result.url).toBe("https://checkout.stripe.com/x");
  });

  it("rejects a non-owner", async () => {
    const accountId = await makeAccount(db);
    await expect(
      startCheckout(
        appDb,
        { accountId, role: "agent" },
        { ownerEmail: "a@example.com", successUrl: "x", cancelUrl: "y" },
      ),
    ).rejects.toMatchObject({ name: "BillingError", code: "not_owner" });
  });

  it("fails clearly when no plan price is configured", async () => {
    delete process.env.STRIPE_PRICE_ID;
    const accountId = await makeAccount(db);
    await expect(
      startCheckout(
        appDb,
        { accountId, role: "owner" },
        { ownerEmail: "a@example.com", successUrl: "x", cancelUrl: "y" },
      ),
    ).rejects.toMatchObject({ name: "BillingError", code: "not_configured" });
  });

  it("reuses an existing Stripe customer instead of an email", async () => {
    const accountId = await makeAccount(db);
    await db
      .update(account)
      .set({ stripeCustomerId: "cus_existing" })
      .where(eq(account.id, accountId));

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

    await startCheckout(
      appDb,
      { accountId, role: "owner" },
      { ownerEmail: "owner@example.com", successUrl: "x", cancelUrl: "y" },
    );
  });
});

describe("startBillingPortal", () => {
  it("rejects an account with no billing history", async () => {
    const accountId = await makeAccount(db);
    await expect(
      startBillingPortal(appDb, { accountId, role: "owner" }, { returnUrl: "x" }),
    ).rejects.toMatchObject({ name: "BillingError", code: "no_subscription" });
  });

  it("opens the portal for an account with a Stripe customer", async () => {
    const accountId = await makeAccount(db);
    await db
      .update(account)
      .set({ stripeCustomerId: "cus_1" })
      .where(eq(account.id, accountId));

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ url: "https://billing.stripe.com/p/1" }), {
            status: 200,
          }),
      ),
    );

    const result = await startBillingPortal(
      appDb,
      { accountId, role: "owner" },
      { returnUrl: "https://app.example/settings/billing" },
    );
    expect(result.url).toBe("https://billing.stripe.com/p/1");
  });

  it("rejects a non-owner", async () => {
    const accountId = await makeAccount(db);
    await expect(
      startBillingPortal(appDb, { accountId, role: "agent" }, { returnUrl: "x" }),
    ).rejects.toMatchObject({ code: "not_owner" });
  });
});

describe("applyCheckoutCompleted", () => {
  it("links the Stripe customer id to the account", async () => {
    const accountId = await makeAccount(db);
    await applyCheckoutCompleted(appDb, { accountId, stripeCustomerId: "cus_new" });
    const [row] = await db.select().from(account).where(eq(account.id, accountId));
    expect(row.stripeCustomerId).toBe("cus_new");
  });
});

describe("applySubscriptionUpdate", () => {
  it("marks the account pro when active and the price matches", async () => {
    const accountId = await makeAccount(db);
    await db
      .update(account)
      .set({ stripeCustomerId: "cus_1" })
      .where(eq(account.id, accountId));

    await applySubscriptionUpdate(appDb, {
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "active",
      priceId: "price_pro",
    });

    const [row] = await db.select().from(account).where(eq(account.id, accountId));
    expect(row.plan).toBe("pro");
    expect(row.subscriptionStatus).toBe("active");
    expect(row.stripeSubscriptionId).toBe("sub_1");
  });

  it("keeps the account free when the status isn't active/trialing", async () => {
    const accountId = await makeAccount(db);
    await db
      .update(account)
      .set({ stripeCustomerId: "cus_1", plan: "pro" })
      .where(eq(account.id, accountId));

    await applySubscriptionUpdate(appDb, {
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "past_due",
      priceId: "price_pro",
    });

    const [row] = await db.select().from(account).where(eq(account.id, accountId));
    expect(row.plan).toBe("free");
    expect(row.subscriptionStatus).toBe("past_due");
  });

  it("does not grant pro for a price that isn't the configured one", async () => {
    const accountId = await makeAccount(db);
    await db
      .update(account)
      .set({ stripeCustomerId: "cus_1" })
      .where(eq(account.id, accountId));

    await applySubscriptionUpdate(appDb, {
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "active",
      priceId: "price_some_other_thing",
    });

    const [row] = await db.select().from(account).where(eq(account.id, accountId));
    expect(row.plan).toBe("free");
  });

  it("a subscription.deleted-shaped update (status canceled) drops the account back to free", async () => {
    const accountId = await makeAccount(db);
    await db
      .update(account)
      .set({ stripeCustomerId: "cus_1", plan: "pro", subscriptionStatus: "active" })
      .where(eq(account.id, accountId));

    await applySubscriptionUpdate(appDb, {
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "canceled",
      priceId: "price_pro",
    });

    const [row] = await db.select().from(account).where(eq(account.id, accountId));
    expect(row.plan).toBe("free");
    expect(row.subscriptionStatus).toBe("canceled");
  });

  it("is a no-op for a Stripe customer id that doesn't match any account", async () => {
    const accountId = await makeAccount(db);
    await applySubscriptionUpdate(appDb, {
      stripeCustomerId: "cus_unknown",
      stripeSubscriptionId: "sub_1",
      status: "active",
      priceId: "price_pro",
    });
    const [row] = await db.select().from(account).where(eq(account.id, accountId));
    expect(row.plan).toBe("free");
    expect(row.stripeSubscriptionId).toBeNull();
  });
});
