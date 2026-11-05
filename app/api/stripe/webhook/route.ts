import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLANS, stripe, toEntitlementStatus, type PlanKey } from "@/lib/stripe";

/** Stripe tells us when a subscription starts, renews, fails or ends; we mirror it onto the company's entitlement. */
export async function POST(request: NextRequest) {
  const sig = request.headers.get("stripe-signature");
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, sig || "", process.env.STRIPE_WEBHOOK_SECRET || "");
  } catch (e) {
    return NextResponse.json({ error: `Bad signature: ${(e as Error).message}` }, { status: 400 });
  }

  const admin = createAdminClient();
  const syncSubscription = async (sub: Stripe.Subscription) => {
    const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const { data: company, error: ce } = await admin.from("companies").select("id").eq("stripe_customer_id", customer).maybeSingle();
    if (ce) throw new Error(ce.message);
    if (!company) throw new Error(`No company for Stripe customer ${customer}`);
    const plan = PLANS[sub.metadata?.plan as PlanKey];
    const { error } = await admin.from("entitlements").upsert(
      {
        company_id: company.id,
        product: plan?.product || "watch",
        status: toEntitlementStatus(sub.status),
        source: "stripe",
        stripe_subscription_id: sub.id,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,product" },
    );
    if (error) throw new Error(error.message);
  };

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.subscription) await syncSubscription(await stripe().subscriptions.retrieve(String(s.subscription)));
        if (s.customer_details?.name && s.customer) {
          // Use the billing name as the company name while the name is still the placeholder.
          await admin.from("companies").update({ name: s.customer_details.name }).eq("stripe_customer_id", String(s.customer)).like("name", "(pending)%");
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        break;
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
