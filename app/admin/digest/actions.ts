"use server";

import { getViewer } from "@/lib/auth";
import { loadContent } from "@/lib/content";
import { digestSubject, renderDigest, renderDigestText } from "@/lib/digest";
import { unsubscribeHeaders, unsubscribePage } from "@/lib/email-links";
import { companiesWith } from "@/lib/entitlements";
import { mailTransport, sendBatch } from "@/lib/mail";
import { siteUrl } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ALL_FUNCTIONS } from "@/lib/types";

export type SendResult = { ok: boolean; sent?: number; error?: string };

const clean = (lines: string[]) => lines.map((l) => String(l).trim().slice(0, 500)).filter(Boolean).slice(0, 20);

/** Re-renders the preview with the corrections the editor typed. */
export async function previewDigest(functions: string[], corrections: string[]): Promise<{ html: string; text: string }> {
  const v = await getViewer();
  if (!v?.isEditor) throw new Error("Only CGM editors can preview the digest.");
  const fns = functions.filter((f) => ALL_FUNCTIONS.includes(f));
  const content = await loadContent(createClient());
  const opts = { corrections: clean(corrections), unsubscribeUrl: `${siteUrl()}/unsubscribe` };
  return { html: renderDigest(content, fns, siteUrl(), opts), text: renderDigestText(content, fns, siteUrl(), opts) };
}

/** Sends this week's digest to every subscriber with access who wants it, each filtered to their functions,
 *  with the editor's corrections, a plain-text part and their own unsubscribe link. Sent by hand from this page,
 *  so the automated-email switch doesn't apply (see the Admin page). */
export async function sendDigest(corrections: string[] = []): Promise<SendResult> {
  const v = await getViewer();
  if (!v?.isEditor) return { ok: false, error: "Only CGM editors can send the digest." };
  if (!mailTransport()) return { ok: false, error: "Email isn't configured: set RESEND_API_KEY and DIGEST_FROM." };

  const admin = createAdminClient();
  const content = await loadContent(admin);
  const { data: people, error } = await admin
    .from("profiles")
    .select("id, email, functions, role, staff_role, company_id")
    .eq("digest_opt_in", true);
  if (error) return { ok: false, error: error.message };

  const watchCompanies = await companiesWith(admin, "watch");
  const recipients = (people || []).filter(
    (p) => p.email && (!!p.staff_role || p.role === "editor" || (p.company_id && watchCompanies.has(p.company_id as string))),
  );
  if (!recipients.length) return { ok: true, sent: 0 };

  const subject = digestSubject(content);
  const site = siteUrl();
  const fixes = clean(corrections);
  try {
    const sent = await sendBatch(
      recipients.map((p) => {
        const fns = (p.functions as string[]) || [];
        const opts = { corrections: fixes, unsubscribeUrl: unsubscribePage(p.id as string, "digest") };
        return {
          to: String(p.email),
          subject,
          html: renderDigest(content, fns, site, opts),
          text: renderDigestText(content, fns, site, opts),
          headers: unsubscribeHeaders(p.id as string, "digest"),
        };
      }),
    );
    await admin.from("weekly_summaries").update({ digest_sent_at: new Date().toISOString() }).is("digest_sent_at", null);
    return { ok: true, sent };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
