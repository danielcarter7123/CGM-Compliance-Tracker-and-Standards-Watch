"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";
import { PRODUCTS, type Product } from "@/lib/entitlements";

// Every write runs as the signed-in admin, so the database's row level security checks it again.

function done(error?: { message: string } | null, msg = "saved"): never {
  revalidatePath("/", "layout");
  redirect(error ? `/admin?error=${encodeURIComponent(error.message)}` : `/admin?ok=${msg}`);
}

export async function setProducts(formData: FormData) {
  await requireAdmin();
  const db = createClient();
  const companyId = String(formData.get("company_id"));
  const wanted = new Set(formData.getAll("products").map(String));
  const seats = Number(formData.get("seats"));
  if (Number.isInteger(seats) && seats >= 1 && seats <= 500) {
    const { error } = await db.from("companies").update({ seats }).eq("id", companyId);
    if (error) done(error);
  }
  const { data: current, error: readErr } = await db.from("entitlements").select("product, status, source").eq("company_id", companyId);
  if (readErr) done(readErr);
  for (const product of PRODUCTS as readonly Product[]) {
    const has = current?.find((e) => e.product === product);
    const live = has && (has.status === "active" || has.status === "trialing");
    if (wanted.has(product) && !live) {
      const { error } = await db.from("entitlements").upsert(
        { company_id: companyId, product, status: "active", source: has?.source === "stripe" ? "stripe" : "contract", updated_at: new Date().toISOString() },
        { onConflict: "company_id,product" },
      );
      if (error) done(error);
    } else if (!wanted.has(product) && live) {
      if (has.source === "stripe") done({ message: `${product} is billed through Stripe. Cancel it in Stripe so billing stops too.` });
      const { error } = await db.from("entitlements").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("company_id", companyId).eq("product", product);
      if (error) done(error);
    }
  }
  done(null, "products");
}

export async function addCompany(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") || "").trim().slice(0, 160);
  if (!name) done({ message: "Enter a company name." });
  const { error } = await createClient().from("companies").insert({ name });
  done(error, "company");
}

export async function setPerson(formData: FormData) {
  const me = await requireAdmin();
  const id = String(formData.get("id"));
  const staff = String(formData.get("staff_role") || "");
  const company = String(formData.get("company_id") || "");
  const companyRole = formData.get("company_role") === "admin" ? "admin" : "member";
  if (id === me.userId && staff !== "admin") done({ message: "You can't remove your own admin role. Ask another CGM admin." });
  const staffRole = staff === "admin" || staff === "pm" || staff === "staff" ? staff : null;
  const { error } = await createClient()
    .from("profiles")
    .update({
      staff_role: staffRole,
      role: staffRole === "admin" ? "editor" : "subscriber",
      company_id: staffRole ? null : company || null,
      company_role: staffRole ? "member" : companyRole,
    })
    .eq("id", id);
  done(error, "person");
}

export async function setEmails(formData: FormData) {
  await requireAdmin();
  const on = formData.get("on") === "true";
  const { error } = await createClient().from("app_settings").update({ value: on }).eq("key", "emails_enabled");
  done(error, on ? "emails-on" : "emails-off");
}

/** Cutover: link someone from the pilot tracker to their login here. Their team tasks (as owner or collaborator) and
 *  their pilot history then show under that login. The database function checks the caller is a CGM admin. */
export async function linkPilotPerson(formData: FormData) {
  await requireAdmin();
  const legacy = String(formData.get("legacy_id") || ""), profile = String(formData.get("profile_id") || "");
  if (!legacy || !profile) done({ message: "Choose a login to link." });
  const { error } = await createClient().rpc("link_legacy_person", { p_legacy_id: legacy, p_profile: profile });
  done(error, "linked");
}
