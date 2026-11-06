import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dueAlerts, type Alert, type DecidedDraft } from "./changes";
import { loadContent } from "./content";
import { DISCLAIMER } from "./digest";
import { unsubscribeHeaders, unsubscribePage } from "./email-links";
import { companiesWith } from "./entitlements";
import { sendBatch, type Mail } from "./mail";
import { emailsEnabled } from "./settings";
import { siteUrl } from "./stripe";
import { matchesFunctions } from "./watch";

/* Standards Watch alerts: between weekly digests, a short email when FERC approves a standard, an effective
   date is set or moves, or a comment period or event is within 14 days. One email per person per run with
   everything that applies to their functions. Automated, so it only runs when emails are switched on. */

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const HEAD: Record<Alert["kind"], string> = { ferc: "New FERC approvals", effective: "Effective dates", deadline: "Coming up within 14 days" };

export function renderAlertEmail(alerts: Alert[], site: string, unsubscribeUrl?: string) {
  const subject = alerts.length === 1 ? `Standards Watch alert: ${alerts[0].label.replace(/\.$/, "")}` : `Standards Watch: ${alerts.length} alerts`;
  const groups = (Object.keys(HEAD) as Alert["kind"][]).map((k) => [k, alerts.filter((a) => a.kind === k)] as const).filter(([, l]) => l.length);
  const html = `<!doctype html><html><body style="margin:0;background:#F4F7FB">
  <div style="max-width:600px;margin:0 auto;padding:24px 20px;font:14px/1.5 Arial,sans-serif;color:#0D1B2E">
    <div style="font:600 12px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#1747D1">CGM Consulting Group · Standards Watch alert</div>
    ${groups.map(([k, l]) => `<h2 style="font:600 17px Arial,sans-serif;margin:22px 0 8px">${HEAD[k]}</h2><ul style="margin:0;padding-left:18px">${l
      .map((a) => `<li style="margin-bottom:6px"><a href="${esc(site + a.href)}" style="color:#0D1B2E">${esc(a.label)}</a></li>`).join("")}</ul>`).join("")}
    <p style="margin:24px 0 0"><a href="${esc(site)}/watch" style="display:inline-block;background:#1747D1;color:#fff;font:600 14px Arial,sans-serif;padding:10px 18px;border-radius:4px;text-decoration:none">Open Standards Watch</a></p>
    <p style="font:12px/1.5 Arial,sans-serif;color:#55657A;margin:22px 0 0">${esc(DISCLAIMER)} ${unsubscribeUrl ? `<a href="${esc(unsubscribeUrl)}" style="color:#55657A">Unsubscribe from alerts</a> · ` : ""}<a href="${esc(site)}/account" style="color:#55657A">Change your functions or emails</a>.</p>
  </div></body></html>`;
  const text = [
    "STANDARDS WATCH ALERT · CGM Consulting Group", "",
    ...groups.flatMap(([k, l]) => [HEAD[k].toUpperCase(), ...l.map((a) => `* ${a.label} ${site}${a.href}`), ""]),
    `Open Standards Watch: ${site}/watch`, "", DISCLAIMER,
    ...(unsubscribeUrl ? [`Unsubscribe from alerts: ${unsubscribeUrl}`] : []),
    `Change your functions or emails: ${site}/account`,
  ].join("\n");
  return { subject, html, text };
}

/** Alerts that would go out now, without sending anything. */
export async function pendingAlerts(admin: SupabaseClient): Promise<Alert[]> {
  const since = new Date(Date.now() - 15 * 864e5).toISOString();
  const [{ data: drafts, error: e1 }, content, { data: log, error: e2 }] = await Promise.all([
    admin.from("drafts").select("id, section, op, key, label, value, previous, decided_at").eq("status", "approved").gte("decided_at", since),
    loadContent(admin),
    admin.from("alert_log").select("key"),
  ]);
  if (e1 || e2) throw new Error((e1 || e2)!.message);
  return dueAlerts((drafts || []) as DecidedDraft[], content.deadlines, new Set((log || []).map((r) => String(r.key))));
}

export type AlertRun = { skipped?: string; alerts: number; emails: number };

/** Sends due alerts to everyone with Watch access who wants alerts, then logs each alert so it never repeats. */
export async function runAlerts(admin: SupabaseClient): Promise<AlertRun> {
  if (!(await emailsEnabled(admin))) return { skipped: "Automated emails are off (Admin page).", alerts: 0, emails: 0 };
  const alerts = await pendingAlerts(admin);
  if (!alerts.length) return { alerts: 0, emails: 0 };

  const { data: people, error } = await admin
    .from("profiles")
    .select("id, email, functions, role, staff_role, company_id")
    .eq("alerts_opt_in", true);
  if (error) throw new Error(error.message);
  const watch = await companiesWith(admin, "watch");
  const site = siteUrl();
  const reach = new Map<string, number>();
  const mails: Mail[] = [];
  for (const p of people || []) {
    if (!p.email || !(p.staff_role || p.role === "editor" || (p.company_id && watch.has(p.company_id as string)))) continue;
    const mine = alerts.filter((a) => matchesFunctions(a.fn, (p.functions as string[]) || []));
    if (!mine.length) continue;
    const m = renderAlertEmail(mine, site, unsubscribePage(p.id as string, "alerts"));
    mails.push({ to: String(p.email), ...m, headers: unsubscribeHeaders(p.id as string, "alerts") });
    for (const a of mine) reach.set(a.key, (reach.get(a.key) || 0) + 1);
  }
  const emails = mails.length ? await sendBatch(mails) : 0;
  const { error: logErr } = await admin
    .from("alert_log")
    .upsert(alerts.map((a) => ({ key: a.key, kind: a.kind, label: a.label, recipients: reach.get(a.key) || 0 })), { onConflict: "key", ignoreDuplicates: true });
  if (logErr) throw new Error(logErr.message);
  return { alerts: alerts.length, emails };
}
