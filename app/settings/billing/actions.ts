"use server";

import { redirect } from "next/navigation";

import { db } from "@/db";
import { appOrigin } from "@/lib/app-url";
import { requireAgent } from "@/lib/auth";
import { BillingError, startBillingPortal, startCheckout } from "@/lib/billing";

/** Owner-only: start a Stripe Checkout session and redirect to it. */
export async function startCheckoutAction(): Promise<void> {
  const current = await requireAgent();
  const origin = await appOrigin();

  let url: string;
  try {
    ({ url } = await startCheckout(
      db,
      { accountId: current.accountId, role: current.role },
      {
        ownerEmail: current.email,
        successUrl: `${origin}/settings/billing?checkout=success`,
        cancelUrl: `${origin}/settings/billing?checkout=canceled`,
      },
    ));
  } catch (error) {
    if (error instanceof BillingError) {
      redirect(`/settings/billing?error=${error.code}`);
    }
    throw error;
  }

  redirect(url);
}

/** Owner-only: open the Stripe-hosted billing portal. */
export async function startPortalAction(): Promise<void> {
  const current = await requireAgent();
  const origin = await appOrigin();

  let url: string;
  try {
    ({ url } = await startBillingPortal(
      db,
      { accountId: current.accountId, role: current.role },
      { returnUrl: `${origin}/settings/billing` },
    ));
  } catch (error) {
    if (error instanceof BillingError) {
      redirect(`/settings/billing?error=${error.code}`);
    }
    throw error;
  }

  redirect(url);
}
