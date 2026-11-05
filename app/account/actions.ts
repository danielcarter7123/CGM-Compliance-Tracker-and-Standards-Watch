"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ALL_FUNCTIONS } from "@/lib/types";

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
