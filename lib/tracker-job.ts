import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { optOutHeaders, optOutPage, type TrackerKind } from "./email-links";
import { isLive } from "./entitlements";
import { sendMail, type Mail } from "./mail";
import { emailsEnabled } from "./settings";
import { siteUrl } from "./stripe";
import { todayIso } from "./tasks";
import {
  digestSections, isWeekday, lookbackDays, renderClientDigest, renderMessagesNotice, renderPmDigest, renderReminders, sectionCount, taskReminder,
  teamReminder, type MailTask, type ReminderItem, type Sections,
} from "./tracker-mail";

/* The weekday Tracker email job (T8). Runs with the service role from /api/jobs/tracker-emails (Vercel Cron), and
   for the Admin page's preview (dry run, nothing sent). Sends only while automated emails are switched on.
   Every email is logged (tracker_email_log) under <kind>:<recipient>:<date>, so a retried run never repeats one.
   Opt-outs are by address (email_optouts); the client record's digest ticks decide who gets client and PM digests. */

export type LogKind = "client_digest" | "pm_digest" | "reminders" | "messages";
export type Planned = { kind: LogKind; to: string; items: number; subject: string; mail: Mail };
export type TrackerRun = { skipped?: string; today: string; planned: { kind: LogKind; to: string; items: number; subject: string }[]; sent: number; failed: number };

const OPT: Record<LogKind, TrackerKind> = { client_digest: "tracker_digest", pm_digest: "tracker_digest", reminders: "tracker_reminders", messages: "messages" };
const norm = (e: unknown) => (typeof e === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim()) ? e.trim().toLowerCase() : "");

async function all<T>(q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

/** What would go out today (dry run), or send it. */
export async function runTrackerEmails(admin: SupabaseClient, opts: { dryRun?: boolean; today?: string } = {}): Promise<TrackerRun> {
  const today = opts.today || todayIso();
  const out: TrackerRun = { today, planned: [], sent: 0, failed: 0 };
  if (!opts.dryRun && !(await emailsEnabled(admin))) return { ...out, skipped: "Automated emails are off (Admin page)." };
  if (!isWeekday(today)) return { ...out, skipped: "Tracker emails go out on weekdays." };
  const lookback = lookbackDays(today);
  const site = siteUrl();

  type Co = { id: string; name: string; pm_id: string | null; sample: boolean };
  type T = MailTask & { assignee_email: string | null; assignee_id: string | null };
  const [cos, ents, tasks, contacts, people, team, optouts, logged, evidence] = await Promise.all([
    all<Co>(admin.from("companies").select("id, name, pm_id, sample")),
    all<{ company_id: string; status: string }>(admin.from("entitlements").select("company_id, status").eq("product", "tracker")),
    all<T>(admin.from("tasks").select("id, company_id, title, standard_code, requirement, facility, due_date, status, remind_days, evidence, assignee_email, assignee_id").neq("status", "done")),
    all<{ company_id: string; kind: string; email: string | null; digest: boolean }>(admin.from("contacts").select("company_id, kind, email, digest")),
    all<{ id: string; email: string | null; staff_role: string | null; company_id: string | null }>(admin.from("profiles").select("id, email, staff_role, company_id")),
    all<{ id: string; title: string; planned_date: string | null; status: string; company_id: string | null; owner_id: string | null; owner_email: string | null }>(
      admin.from("team_tasks").select("id, title, planned_date, status, company_id, owner_id, owner_email").neq("status", "done")),
    all<{ email: string; kind: string }>(admin.from("email_optouts").select("email, kind")),
    all<{ key: string; kind: string; recipient: string; sent_at: string }>(admin.from("tracker_email_log").select("key, kind, recipient, sent_at").gte("sent_at", new Date(Date.now() - 40 * 86400e3).toISOString())),
    all<{ task_id: string }>(admin.from("evidence").select("task_id").not("task_id", "is", null).is("removed_at", null)),
  ]);
  const live = new Set(ents.filter((e) => isLive(e.status)).map((e) => e.company_id));
  const clients = new Map(cos.filter((c) => live.has(c.id) && !c.sample).map((c) => [c.id, c]));
  const withEvidence = new Set(evidence.map((e) => e.task_id));
  const open = tasks.filter((t) => clients.has(t.company_id)).map((t) => ({ ...t, has_evidence: withEvidence.has(t.id) }));
  const byCompany = new Map<string, MailTask[]>();
  for (const t of open) byCompany.set(t.company_id, [...(byCompany.get(t.company_id) || []), t]);
  const emailOf = new Map(people.map((p) => [p.id, norm(p.email)]));
  const optedOut = new Set(optouts.map((o) => `${o.email}|${o.kind}`));
  const done = new Set(logged.map((l) => l.key));
  const planned: Planned[] = [];
  const plan = (kind: LogKind, to: string, items: number, m: { subject: string; html: string; text: string }) => {
    if (!to || optedOut.has(`${to}|${OPT[kind]}`) || done.has(`${kind}:${to}:${today}`)) return;
    planned.push({ kind, to, items, subject: m.subject, mail: { to, ...m, headers: optOutHeaders(to, OPT[kind]) } });
  };
  const sectionsFor = (cid: string) => digestSections(byCompany.get(cid) || [], today);

  // Client digests: each client's compliance contact and (if ticked) plant manager.
  const sent = new Set<string>();
  for (const c of contacts) {
    const to = norm(c.email), client = clients.get(c.company_id);
    if (!client || !c.digest || !to || !["compliance", "plant_manager"].includes(c.kind) || sent.has(`${to}|${client.id}`)) continue;
    sent.add(`${to}|${client.id}`);
    const s = sectionsFor(client.id);
    if (!sectionCount(s)) continue;
    plan("client_digest", to, sectionCount(s), renderClientDigest(client.name, s, site, optOutPage(to, "tracker_digest")));
  }

  // PM digests: one email per PM across their clients (the client record's PM contact, and the assigned CGM PM).
  const pmClients = new Map<string, Set<string>>();
  const addPm = (to: string, cid: string) => { if (to) pmClients.set(to, (pmClients.get(to) || new Set()).add(cid)); };
  for (const c of contacts) if (c.kind === "pm" && c.digest && clients.has(c.company_id)) addPm(norm(c.email), c.company_id);
  for (const c of clients.values()) if (c.pm_id) addPm(emailOf.get(c.pm_id) || "", c.id);
  for (const [to, ids] of pmClients) {
    const groups = [...ids].map((id) => ({ client: clients.get(id)!.name, s: sectionsFor(id) })).filter((g) => sectionCount(g.s))
      .sort((a, b) => a.client.localeCompare(b.client));
    if (!groups.length) continue;
    plan("pm_digest", to, groups.reduce((n, g) => n + sectionCount(g.s as Sections), 0), renderPmDigest(groups, site, optOutPage(to, "tracker_digest")));
  }

  // Reminders: task assignees and team-task owners, one email per person.
  const items = new Map<string, ReminderItem[]>();
  const add = (to: string, i: ReminderItem) => { if (to) items.set(to, [...(items.get(to) || []), i]); };
  for (const t of open) {
    const note = taskReminder(t, today, lookback);
    if (note) add(norm(t.assignee_email) || (t.assignee_id ? emailOf.get(t.assignee_id) || "" : ""), { kind: "task", id: t.id, title: t.title, date: t.due_date!, note, client: clients.get(t.company_id)!.name });
  }
  for (const t of team) {
    const note = teamReminder(t, today, lookback);
    if (note) add(norm(t.owner_email) || (t.owner_id ? emailOf.get(t.owner_id) || "" : ""), { kind: "team", id: t.id, title: t.title, date: t.planned_date!, note, client: t.company_id ? clients.get(t.company_id)?.name || "" : "" });
  }
  for (const [to, list] of items) plan("reminders", to, list.length, renderReminders(list.sort((a, b) => a.date.localeCompare(b.date)), site, optOutPage(to, "tracker_reminders")));

  // Unread messages: one notice a day, only when something new arrived since the last notice.
  const [chats, reads] = await Promise.all([
    all<{ id: string; type: string; members: string[]; company_id: string | null; last_at: string | null; last_by: string | null }>(admin.from("chats").select("id, type, members, company_id, last_at, last_by").not("last_at", "is", null)),
    all<{ user_id: string; chat_id: string; read_at: string }>(admin.from("chat_reads").select("user_id, chat_id, read_at")),
  ]);
  const readAt = new Map(reads.map((r) => [`${r.user_id}|${r.chat_id}`, r.read_at]));
  const lastNotice = new Map<string, string>();
  for (const l of logged) if (l.kind === "messages" && (lastNotice.get(l.recipient) || "") < l.sent_at) lastNotice.set(l.recipient, l.sent_at);
  for (const p of people) {
    const to = norm(p.email);
    if (!to) continue;
    const canSee = (c: (typeof chats)[number]) =>
      c.type === "channel" ? !!p.staff_role : c.type === "dm" ? c.members.includes(p.id) : !!p.staff_role || (!!p.company_id && p.company_id === c.company_id && live.has(c.company_id));
    const unread = chats.filter((c) => canSee(c) && c.last_by !== p.id && (!readAt.has(`${p.id}|${c.id}`) || c.last_at! > readAt.get(`${p.id}|${c.id}`)!));
    if (!unread.length) continue;
    const newest = unread.reduce((m, c) => (c.last_at! > m ? c.last_at! : m), "");
    if (lastNotice.has(to) && newest <= lastNotice.get(to)!) continue;
    plan("messages", to, unread.length, renderMessagesNotice(unread.length, site, optOutPage(to, "messages")));
  }

  out.planned = planned.map(({ kind, to, items: n, subject }) => ({ kind, to, items: n, subject }));
  if (opts.dryRun) return out;
  for (const p of planned) {
    const ok = await sendMail(p.mail).catch(() => false); // one bad address doesn't stop the rest
    if (ok) {
      out.sent++;
      await admin.from("tracker_email_log").insert({ key: `${p.kind}:${p.to}:${today}`, kind: p.kind, recipient: p.to, items: p.items });
    } else out.failed++;
  }
  return out;
}
