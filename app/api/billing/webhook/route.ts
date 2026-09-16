import { db } from "@/db";
import {
  applyCheckoutCompleted,
  applySubscriptionUpdate,
} from "@/lib/billing";
import { jsonError, jsonOk } from "@/lib/http";
import { verifyStripeSignature } from "@/lib/stripe";

/**
 * Stripe's webhook endpoint (M9). Verified with `STRIPE_WEBHOOK_SECRET` —
 * generated when a webhook endpoint pointing here is added in the Stripe
 * dashboard, separate from `STRIPE_SECRET_KEY`.
 *
 * Only two event types are handled; everything else gets a 200 with no
 * action — Stripe retries on anything but a 2xx, and there is no reason to
 * make it retry an event this app doesn't act on.
 */

type StripeEvent = {
  type: string;
  data: { object: Record<string, unknown> };
};

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return jsonError("Webhook is not configured", 500, "not_configured");
  }

  const rawBody = await request.text();
  const authentic = verifyStripeSignature(
    rawBody,
    request.headers.get("stripe-signature"),
    secret,
  );
  if (!authentic) {
    return jsonError("Invalid signature", 401, "unauthorised");
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonError("Body is not valid JSON", 400, "invalid_json");
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as {
        client_reference_id?: string | null;
        customer?: string | null;
      };
      if (session.client_reference_id && session.customer) {
        await applyCheckoutCompleted(db, {
          accountId: session.client_reference_id,
          stripeCustomerId: session.customer,
        });
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as {
        id: string;
        customer: string;
        status: string;
        items?: { data?: { price?: { id?: string } }[] };
      };
      await applySubscriptionUpdate(db, {
        stripeCustomerId: subscription.customer,
        stripeSubscriptionId: subscription.id,
        status: subscription.status,
        priceId: subscription.items?.data?.[0]?.price?.id ?? null,
      });
      break;
    }

    default:
      break;
  }

  return jsonOk({ received: true });
}
