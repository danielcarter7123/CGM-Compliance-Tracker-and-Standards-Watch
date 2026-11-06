"use server";

import { redirect } from "next/navigation";
import { LIST_COLUMN, isListKind, openOptOut, verifyUnsubscribe } from "@/lib/email-links";
import { createAdminClient } from "@/lib/supabase/admin";

/** Turns off one kind of email for the person (or address) the link belongs to. The signature or seal is the check. */
export async function confirmUnsubscribe(formData: FormData) {
  const x = String(formData.get("x") || "");
  if (x) {
    const o = openOptOut(x);
    if (!o) redirect("/unsubscribe?bad=1");
    const { error } = await createAdminClient().from("email_optouts").upsert({ email: o.email, kind: o.kind }, { onConflict: "email,kind", ignoreDuplicates: true });
    if (error) redirect("/unsubscribe?bad=1");
    redirect(`/unsubscribe?done=${o.kind}`);
  }
  const u = String(formData.get("u") || ""), k = formData.get("k"), t = String(formData.get("t") || "");
  if (!isListKind(k) || !verifyUnsubscribe(u, k, t)) redirect("/unsubscribe?bad=1");
  const { error } = await createAdminClient().from("profiles").update({ [LIST_COLUMN[k]]: false }).eq("id", u);
  if (error) redirect(`/unsubscribe?bad=1`);
  redirect(`/unsubscribe?done=${k}`);
}
