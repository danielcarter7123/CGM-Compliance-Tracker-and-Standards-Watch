"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ALL_FUNCTIONS, REGIONS } from "@/lib/types";

const safeNext = (n: unknown) =>
  typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/welcome") ? n : "/watch";

/** Saves the first-login choices. Runs as the user, so the database only lets them change their own profile. */
export async function finishWelcome(formData: FormData) {
  const db = createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect("/login?next=/welcome");
  const next = safeNext(formData.get("next"));
  const region = String(formData.get("region") || "");
  const { error } = await db
    .from("profiles")
    .update({
      full_name: String(formData.get("full_name") || "").trim().slice(0, 120) || null,
      functions: formData.getAll("functions").map(String).filter((f) => ALL_FUNCTIONS.includes(f)),
      region: (REGIONS as readonly string[]).includes(region) ? region : null,
      digest_opt_in: formData.get("digest") === "on",
      onboarded_at: new Date().toISOString(),
    })
    .eq("id", auth.user.id);
  if (error) redirect(`/welcome?next=${encodeURIComponent(next)}&error=${encodeURIComponent(error.message)}`);
  redirect(next);
}
