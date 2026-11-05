import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLANS, siteUrl, stripe, type PlanKey } from "@/lib/stripe";

/** Starts a Stripe Checkout subscription for the signed-in visitor's company. */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const plan = String(form.get("plan") || "watch_monthly") as PlanKey;
  const price = PLANS[plan]?.price();
  if (!price) return NextResponse.json({ error: "Unknown plan or missing Stripe price ID" }, { status: 400 });

  const db = createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login?next=/%23plans", siteUrl()), 303);

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("company_id, email").eq("id", auth.user.id).single();
  let companyId = profile?.company_id as string | null;
  let customerId: string | null = null;

  if (companyId) {
    const { data: c } = await admin.from("companies").select("stripe_customer_id").eq("id", companyId).single();
    customerId = (c?.stripe_customer_id as string | null) ?? null;
  } else {
    // First purchase: create the company. Its name is a placeholder until Stripe returns the billing name.
    const domain = (auth.user.email || "").split("@")[1] || "New company";
    const { data: c, error } = await admin.from("companies").insert({ name: `(pending) ${domain}` }).select("id").single();
    if (error || !c) return NextResponse.json({ error: error?.message || "Could not create company" }, { status: 500 });
    companyId = c.id as string;
    await admin.from("profiles").update({ company_id: companyId, company_role: "admin" }).eq("id", auth.user.id);
  }

  if (!customerId) {
    const customer = await stripe().customers.create({ email: auth.user.email ?? undefined, metadata: { company_id: companyId } });
    customerId = customer.id;
    await admin.from("companies").update({ stripe_customer_id: customerId }).eq("id", companyId);
  }

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    customer_update: { name: "auto", address: "auto" },
    subscription_data: { metadata: { company_id: companyId, plan } },
    success_url: `${siteUrl()}/account?checkout=success`,
    cancel_url: `${siteUrl()}/?checkout=cancelled#plans`,
  });
  return NextResponse.redirect(session.url!, 303);
}
