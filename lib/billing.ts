import { eq } from "drizzle-orm";

import type { AppDb } from "@/db";
import { account, type AccountPlan, type AgentRole } from "@/db/schema";
import { createBillingPortalSession, createCheckoutSession } from "@/lib/stripe";

/**
 * Billing scaffolding (M9): one paid tier ("pro"), Stripe Checkout to start
 * a subscription, the Stripe Customer Portal to manage/cancel one, and a
 * webhook that keeps `account.plan` in sync. Nothing reads `account.plan` to
 * gate a feature yet — that is a real product decision for later, not this
 * milestone (see docs/roadmap.md).
 */

export class BillingError extends Error {
  constructor(
    readonly code: "not_owner" | "not_configured" | "no_subscription",
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

function requireOwner(role: AgentRole): void {
  if (role !== "owner") {
    throw new BillingError("not_owner", "Only the account owner can manage billing.");
  }
}

function priceId(): string {
  const value = process.env.STRIPE_PRICE_ID;
  if (!value) {
    throw new BillingError(
      "not_configured",
      "Billing isn't fully set up yet — no plan price is configured.",
    );
  }
  return value;
}

export type BillingStatus = {
  plan: AccountPlan;
  subscriptionStatus: string | null;
  hasStripeCustomer: boolean;
};

export async function getBillingStatus(
  db: AppDb,
  accountId: string,
): Promise<BillingStatus> {
  const [row] = await db
    .select({
      plan: account.plan,
      subscriptionStatus: account.subscriptionStatus,
      stripeCustomerId: account.stripeCustomerId,
    })
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1);

  return {
    plan: row?.plan ?? "free",
    subscriptionStatus: row?.subscriptionStatus ?? null,
    hasStripeCustomer: Boolean(row?.stripeCustomerId),
  };
}

/**
 * Start (or resume) a Stripe Checkout session for the "pro" plan. Reuses the
 * account's existing Stripe customer if it has one (a lapsed subscriber
 * re-subscribing), otherwise lets Stripe create one from the owner's email.
 */
export async function startCheckout(
  db: AppDb,
  actor: { accountId: string; role: AgentRole },
  input: { ownerEmail: string; successUrl: string; cancelUrl: string },
): Promise<{ url: string }> {
  requireOwner(actor.role);
  const stripePriceId = priceId();

  const [row] = await db
    .select({ stripeCustomerId: account.stripeCustomerId })
    .from(account)
    .where(eq(account.id, actor.accountId))
    .limit(1);

  return createCheckoutSession({
    priceId: stripePriceId,
    accountId: actor.accountId,
    customerId: row?.stripeCustomerId ?? undefined,
    customerEmail: row?.stripeCustomerId ? undefined : input.ownerEmail,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
  });
}

/** Open the Stripe-hosted portal — requires having been through checkout once. */
export async function startBillingPortal(
  db: AppDb,
  actor: { accountId: string; role: AgentRole },
  input: { returnUrl: string },
): Promise<{ url: string }> {
  requireOwner(actor.role);

  const [row] = await db
    .select({ stripeCustomerId: account.stripeCustomerId })
    .from(account)
    .where(eq(account.id, actor.accountId))
    .limit(1);

  if (!row?.stripeCustomerId) {
    throw new BillingError(
      "no_subscription",
      "There's no billing history for this account yet.",
    );
  }

  return createBillingPortalSession({
    customerId: row.stripeCustomerId,
    returnUrl: input.returnUrl,
  });
}

/**
 * `checkout.session.completed`: link the Stripe customer Checkout created
 * (or reused) to our account. The subscription's actual status comes from a
 * separate `customer.subscription.*` event — Stripe fires both, and the
 * subscription event is the source of truth for `plan`.
 */
export async function applyCheckoutCompleted(
  db: AppDb,
  input: { accountId: string; stripeCustomerId: string },
): Promise<void> {
  await db
    .update(account)
    .set({ stripeCustomerId: input.stripeCustomerId, updatedAt: new Date() })
    .where(eq(account.id, input.accountId));
}

// Statuses that entitle the "pro" plan. Anything else (past_due, unpaid,
// canceled, incomplete, incomplete_expired, ...) reads as "free" — a
// placeholder policy with zero effect today since nothing gates on `plan`
// yet (see docs/decisions.md).
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

/**
 * `customer.subscription.created` / `.updated` / `.deleted`: the source of
 * truth for `plan` and `subscription_status`. Looked up by
 * `stripe_customer_id`, not by any id we chose — if no account has that
 * customer (a webhook from a different Stripe account/environment, or one
 * that arrived before `applyCheckoutCompleted` on a race), this is a no-op,
 * not an error; Stripe's own retry will eventually land after the other
 * event has landed too.
 */
export async function applySubscriptionUpdate(
  db: AppDb,
  input: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    status: string;
    priceId: string | null;
  },
): Promise<void> {
  const configuredPriceId = process.env.STRIPE_PRICE_ID;
  const plan: AccountPlan =
    ACTIVE_STATUSES.has(input.status) &&
    configuredPriceId &&
    input.priceId === configuredPriceId
      ? "pro"
      : "free";

  await db
    .update(account)
    .set({
      stripeSubscriptionId: input.stripeSubscriptionId,
      subscriptionStatus: input.status,
      plan,
      updatedAt: new Date(),
    })
    .where(eq(account.stripeCustomerId, input.stripeCustomerId));
}
