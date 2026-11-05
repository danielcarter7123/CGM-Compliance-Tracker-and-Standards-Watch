"use server";

import { Resend } from "resend";
import { getViewer } from "@/lib/auth";
import { loadContent } from "@/lib/content";
import { digestSubject, renderDigest } from "@/lib/digest";
import { siteUrl } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { companiesWith } from "@/lib/entitlements";

export type SendResult = { ok: boolean; sent?: number; error?: string };

/** Sends this week's digest to every subscriber with access who wants it, each filtered to their functions. */
export async function sendDigest(): Promise<SendResult> {
  const v = await getViewer();
  if (!v?.isEditor) return { ok: false, error: "Only CGM editors can send the digest." };
  if (!process.env.RESEND_API_KEY || !process.env.DIGEST_FROM) return { ok: false, error: "RESEND_API_KEY and DIGEST_FROM must be set." };

  const admin = createAdminClient();
  const content = await loadContent(admin);
  const { data: people, error } = await admin
    .from("profiles")
    .select("email, functions, role, staff_role, company_id, digest_opt_in")
    .eq("digest_opt_in", true);
  if (error) return { ok: false, error: error.message };

  const watchCompanies = await companiesWith(admin, "watch");
  const recipients = (people || []).filter(
    (p) => p.email && (!!p.staff_role || p.role === "editor" || (p.company_id && watchCompanies.has(p.company_id as string))),
  );
  if (!recipients.length) return { ok: true, sent: 0 };

  const resend = new Resend(process.env.RESEND_API_KEY);
  const subject = digestSubject(content);
  let sent = 0;
  for (let i = 0; i < recipients.length; i += 100) {
    const batch = recipients.slice(i, i + 100).map((p) => ({
      from: process.env.DIGEST_FROM!,
      to: [String(p.email)],
      subject,
      html: renderDigest(content, (p.functions as string[]) || [], siteUrl()),
    }));
    const { error: e } = await resend.batch.send(batch);
    if (e) return { ok: false, sent, error: e.message };
    sent += batch.length;
  }
  await admin.from("weekly_summaries").update({ digest_sent_at: new Date().toISOString() }).is("digest_sent_at", null);
  return { ok: true, sent };
}
