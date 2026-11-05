import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;
export function stripe() {
  if (!client) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
    client = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return client;
}

/** Self-serve plans sold through Stripe Checkout. The Compliance Tracker is sold by contract and switched on
    by a CGM admin (entitlements.source = 'contract'), so it has no entry here unless CGM decides to sell it online. */
export const PLANS = {
  watch_monthly: { label: "Watch, monthly", product: "watch", price: () => process.env.STRIPE_PRICE_WATCH_MONTHLY },
  watch_annual: { label: "Watch, annual", product: "watch", price: () => process.env.STRIPE_PRICE_WATCH_ANNUAL },
} as const;
export type PlanKey = keyof typeof PLANS;

/** Stripe subscription status -> entitlements.status. Only active and trialing grant access. */
export function toEntitlementStatus(s: Stripe.Subscription.Status): "active" | "trialing" | "past_due" | "canceled" {
  if (s === "active") return "active";
  if (s === "trialing") return "trialing";
  if (s === "canceled" || s === "incomplete_expired") return "canceled";
  return "past_due"; // past_due, unpaid, incomplete, paused
}

export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
