import type { Metadata } from "next";
import Link from "next/link";

import { db } from "@/db";
import { requireAgent } from "@/lib/auth";
import { getBillingStatus } from "@/lib/billing";

import { startCheckoutAction, startPortalAction } from "./actions";

export const metadata: Metadata = { title: "Billing · One Inbox" };

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Billing isn't fully set up yet — no plan price is configured.",
  no_subscription: "There's no billing history for this account yet.",
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; error?: string }>;
}) {
  const agent = await requireAgent();
  const status = await getBillingStatus(db, agent.accountId);
  const isOwner = agent.role === "owner";
  const { checkout, error } = await searchParams;

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/inbox" className="link">
          ← Inbox
        </Link>
        <strong>Billing</strong>
        <span className="muted">{agent.email}</span>
      </header>

      <main className="team-main stack">
        {checkout === "success" ? (
          <p role="status" className="muted">
            Thanks! It can take a few seconds for the new plan to show below.
          </p>
        ) : null}
        {checkout === "canceled" ? (
          <p className="muted">Checkout was canceled — no changes were made.</p>
        ) : null}
        {error ? (
          <p role="alert" className="error">
            {ERROR_MESSAGES[error] ?? "Something went wrong."}
          </p>
        ) : null}

        <section className="stack">
          <h2>Current plan</h2>
          <p>
            <span className="chan" data-plan={status.plan}>
              {status.plan}
            </span>
            {status.subscriptionStatus ? (
              <span className="muted"> — {status.subscriptionStatus}</span>
            ) : null}
          </p>

          {isOwner ? (
            status.hasStripeCustomer ? (
              <form action={startPortalAction}>
                <button type="submit">Manage billing</button>
              </form>
            ) : (
              <form action={startCheckoutAction}>
                <button type="submit">Upgrade to Pro</button>
              </form>
            )
          ) : (
            <p className="muted">Only the account owner can manage billing.</p>
          )}
        </section>
      </main>
    </div>
  );
}
