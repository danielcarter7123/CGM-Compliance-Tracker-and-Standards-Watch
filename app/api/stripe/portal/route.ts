import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl, stripe } from "@/lib/stripe";

/** Opens Stripe's customer portal (update card, see invoices, cancel). */
export async function POST() {
  const db = createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login?next=/account", siteUrl()), 303);
  const admin = createAdminClient();
  const { data: p } = await admin.from("profiles").select("company_role, company:companies(stripe_customer_id)").eq("id", auth.user.id).single();
  if (p?.company_role !== "admin") return NextResponse.redirect(new URL("/account", siteUrl()), 303); // billing is for company admins
  const customer = (p?.company as { stripe_customer_id?: string } | null)?.stripe_customer_id;
  if (!customer) return NextResponse.redirect(new URL("/account", siteUrl()), 303);
  const session = await stripe().billingPortal.sessions.create({ customer, return_url: `${siteUrl()}/account` });
  return NextResponse.redirect(session.url, 303);
}
