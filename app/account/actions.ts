"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ALL_FUNCTIONS, REGIONS } from "@/lib/types";

export async function savePreferences(formData: FormData) {
  const db = createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect("/login?next=/account");
  const functions = formData.getAll("functions").map(String).filter((f) => ALL_FUNCTIONS.includes(f));
  const { error } = await db
    .from("profiles")
    .update({
      functions,
      digest_opt_in: formData.get("digest") === "on",
      alerts_opt_in: formData.get("alerts") === "on",
      region: (REGIONS as readonly string[]).includes(String(formData.get("region"))) ? String(formData.get("region")) : null,
      full_name: String(formData.get("full_name") || "").slice(0, 120) || null,
    })
    .eq("id", auth.user.id);
  if (error) redirect(`/account?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/account");
  redirect("/account?saved=1");
}

export async function signOut() {
  await createClient().auth.signOut();
  redirect("/");
}

/** CGM Compliance Tracker emails for the signed-in person's own address (email_optouts; row level security limits
 *  each person to their own address). Unticked means opted out. */
export async function saveTrackerEmails(formData: FormData) {
  const db = createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect("/login?next=/account");
  const { data: me } = await db.from("profiles").select("email").eq("id", auth.user.id).maybeSingle();
  const email = String(me?.email || "").toLowerCase();
  if (!email) redirect(`/account?error=${encodeURIComponent("Your account has no email address.")}`);
  for (const kind of ["tracker_digest", "tracker_reminders", "messages"] as const) {
    const want = formData.get(kind) === "on";
    const { error } = want
      ? await db.from("email_optouts").delete().eq("email", email).eq("kind", kind)
      : await db.from("email_optouts").upsert({ email, kind }, { onConflict: "email,kind", ignoreDuplicates: true });
    if (error) redirect(`/account?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/account");
  redirect("/account?saved=1#tracker-emails");
}
