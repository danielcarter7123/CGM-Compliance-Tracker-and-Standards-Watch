// T8 Tracker emails: what goes in each weekday email, as pure functions (tested). The job in lib/tracker-job.ts
// gathers the data, applies the switches and opt-outs, sends, and logs.
// - Client digest (to a client's compliance contact and, if ticked, plant manager): that client's overdue and
//   coming-due tasks, performed tasks still missing the report, and tasks waiting for CGM's review.
// - PM digest: the same, for every client the PM manages, in one email.
// - Reminders (the live tracker's per-person emails): a task's assignee when the task enters a reminder window, on
//   its due date and every weekday while overdue; a team task's owner 7 days before the anticipated date, on it,
//   and every weekday while late. One email per person per day listing everything.
// - Unread messages: at most one notice a day, only when something new arrived since the last notice.
// Tasks without a due date are skipped (the dashboard banner says so). Client tasks are never included.

export type MailTask = {
  id: string;
  company_id: string;
  title: string;
  standard_code: string | null;
  requirement: string | null;
  facility: string | null;
  due_date: string | null;
  status: "open" | "inprogress" | "review" | "done";
  remind_days: number[];
  evidence: string | null;
  has_evidence?: boolean;
};
export type MailTeamTask = { id: string; title: string; planned_date: string | null; status: string; company_id: string | null };
export type Sections = { overdue: MailTask[]; due30: MailTask[]; noReport: MailTask[]; review: MailTask[] };
export type ReminderItem = { kind: "task" | "team"; id: string; title: string; date: string; note: string; client: string };

export const HORIZON_DAYS = 30;
const DAY = 86400e3;
export const daysFrom = (today: string, d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
const hasReport = (t: MailTask) => (!!t.evidence && /^https:\/\/\S+$/i.test(t.evidence.trim())) || !!t.has_evidence;

/** Days the run covers: Monday's run also covers Saturday and Sunday, so nothing that started then is missed. */
export const lookbackDays = (today: string) => (new Date(`${today}T00:00:00Z`).getUTCDay() === 1 ? 3 : 1);
export const isWeekday = (today: string) => { const d = new Date(`${today}T00:00:00Z`).getUTCDay(); return d >= 1 && d <= 5; };

export function digestSections(tasks: MailTask[], today: string, horizon = HORIZON_DAYS): Sections {
  const open = tasks.filter((t) => (t.status === "open" || t.status === "inprogress") && t.due_date);
  const byDue = (a: MailTask, b: MailTask) => (a.due_date || "").localeCompare(b.due_date || "") || a.title.localeCompare(b.title);
  return {
    overdue: open.filter((t) => daysFrom(today, t.due_date!) < 0).sort(byDue),
    due30: open.filter((t) => { const n = daysFrom(today, t.due_date!); return n >= 0 && n <= horizon; }).sort(byDue),
    noReport: tasks.filter((t) => t.status === "review" && !hasReport(t)).sort(byDue),
    review: tasks.filter((t) => t.status === "review" && hasReport(t)).sort(byDue),
  };
}
export const sectionCount = (s: Sections) => s.overdue.length + s.due30.length + s.noReport.length + s.review.length;

/** Why a task is in today's reminder, or null. */
export function taskReminder(t: Pick<MailTask, "status" | "due_date" | "remind_days">, today: string, lookback = 1): string | null {
  if (!(t.status === "open" || t.status === "inprogress") || !t.due_date) return null;
  const d = daysFrom(today, t.due_date);
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
  if (d === 0) return "due today";
  for (const r of [...(t.remind_days || [])].sort((a, b) => a - b)) if (d > r - lookback && d <= r) return `due in ${d} day${d === 1 ? "" : "s"}`;
  return null;
}
/** Why a team task is in today's reminder, or null (7 days before the anticipated date, on it, and while late). */
export function teamReminder(t: Pick<MailTeamTask, "status" | "planned_date">, today: string, lookback = 1): string | null {
  if (t.status === "done" || !t.planned_date) return null;
  const d = daysFrom(today, t.planned_date);
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} past the anticipated date`;
  if (d === 0) return "anticipated today";
  if (d > 7 - lookback && d <= 7) return `anticipated in ${d} day${d === 1 ? "" : "s"}`;
  return null;
}

// ---------- rendering ----------
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const code = (t: MailTask) => [t.standard_code, t.requirement].filter(Boolean).join(" ");
const line = (t: MailTask) => `${t.due_date ? fmtDate(t.due_date) : "No date"} · ${code(t) ? `${code(t)} · ` : ""}${t.title}${t.facility ? ` (${t.facility})` : ""}`;

const SECTION_HEAD: Record<keyof Sections, string> = {
  overdue: "Overdue",
  due30: `Due in the next ${HORIZON_DAYS} days`,
  noReport: "Performed, report not posted yet",
  review: "Performed, waiting for CGM's review",
};
const ORDER: (keyof Sections)[] = ["overdue", "due30", "noReport", "review"];

function shell(kicker: string, body: string, site: string, footer: string) {
  return `<!doctype html><html><body style="margin:0;background:#F4F7FB">
  <div style="max-width:640px;margin:0 auto;padding:24px 20px;font:14px/1.5 Arial,sans-serif;color:#0D1B2E">
    <div style="font:600 12px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#1747D1">${esc(kicker)}</div>
    ${body}
    <p style="margin:24px 0 0"><a href="${esc(site)}/tracker" style="display:inline-block;background:#1747D1;color:#fff;font:600 14px Arial,sans-serif;padding:10px 18px;border-radius:4px;text-decoration:none">Open CGM Compliance Tracker</a></p>
    <p style="font:12px/1.5 Arial,sans-serif;color:#55657A;margin:22px 0 0">${footer}</p>
  </div></body></html>`;
}
function sectionsHtml(s: Sections, site: string) {
  return ORDER.filter((k) => s[k].length).map((k) => `<h3 style="font:600 15px Arial,sans-serif;margin:18px 0 6px">${SECTION_HEAD[k]} (${s[k].length})</h3>
    <ul style="margin:0;padding-left:18px">${s[k].map((t) => `<li style="margin-bottom:4px"><a href="${esc(site)}/tracker/tasks?status=all&amp;t=${esc(t.id)}" style="color:#0D1B2E">${esc(line(t))}</a></li>`).join("")}</ul>`).join("");
}
function sectionsText(s: Sections, site: string) {
  return ORDER.filter((k) => s[k].length).flatMap((k) => [`${SECTION_HEAD[k].toUpperCase()} (${s[k].length})`, ...s[k].map((t) => `* ${line(t)}  ${site}/tracker/tasks?status=all&t=${t.id}`), ""]);
}
const footerHtml = (why: string, unsub: string, site: string) =>
  `${esc(why)} <a href="${esc(unsub)}" style="color:#55657A">Unsubscribe</a> · <a href="${esc(site)}/account" style="color:#55657A">Email settings</a>. Links open the task, never a file.`;
const footerText = (why: string, unsub: string, site: string) => [why, `Unsubscribe: ${unsub}`, `Email settings: ${site}/account`];

function counts(s: Sections) {
  const bits = [s.overdue.length && `${s.overdue.length} overdue`, s.due30.length && `${s.due30.length} due in ${HORIZON_DAYS} days`,
    s.noReport.length && `${s.noReport.length} missing a report`].filter(Boolean);
  return bits.length ? bits.join(", ") : `${s.review.length} waiting for review`;
}

export function renderClientDigest(client: string, s: Sections, site: string, unsub: string) {
  const why = `You get this weekday digest as a contact for ${client}.`;
  return {
    subject: `${client}: ${counts(s)} · CGM Compliance Tracker`,
    html: shell(`CGM Compliance Tracker · ${client}`, sectionsHtml(s, site), site, footerHtml(why, unsub, site)),
    text: [`CGM COMPLIANCE TRACKER · ${client}`, "", ...sectionsText(s, site), `Open CGM Compliance Tracker: ${site}/tracker`, "", ...footerText(why, unsub, site)].join("\n"),
  };
}

export function renderPmDigest(groups: { client: string; s: Sections }[], site: string, unsub: string) {
  const total = groups.reduce((n, g) => n + g.s.overdue.length, 0);
  const why = "You get this weekday digest as the CGM project manager for these clients.";
  return {
    subject: `Your clients: ${total} overdue across ${groups.length} client${groups.length === 1 ? "" : "s"} · CGM Compliance Tracker`,
    html: shell("CGM Compliance Tracker · your clients",
      groups.map((g) => `<h2 style="font:600 17px Arial,sans-serif;margin:22px 0 4px">${esc(g.client)}</h2>${sectionsHtml(g.s, site)}`).join(""), site, footerHtml(why, unsub, site)),
    text: ["CGM COMPLIANCE TRACKER · YOUR CLIENTS", "", ...groups.flatMap((g) => [`== ${g.client} ==`, ...sectionsText(g.s, site)]), `Open CGM Compliance Tracker: ${site}/tracker`, "", ...footerText(why, unsub, site)].join("\n"),
  };
}

export function renderReminders(items: ReminderItem[], site: string, unsub: string) {
  const href = (i: ReminderItem) => `${site}${i.kind === "team" ? `/tracker/team?scope=everyone&status=all&t=${i.id}` : `/tracker/tasks?status=all&t=${i.id}`}`;
  const label = (i: ReminderItem) => `${i.title}${i.client ? ` (${i.client})` : ""}: ${i.note}, ${fmtDate(i.date)}`;
  const why = "You get these reminders because tasks are assigned to you in CGM Compliance Tracker.";
  const overdue = items.filter((i) => /overdue|past/.test(i.note)).length;
  return {
    subject: items.length === 1 ? `Reminder: ${items[0].title} is ${items[0].note}` : `Reminders: ${items.length} tasks${overdue ? `, ${overdue} overdue` : ""} · CGM Compliance Tracker`,
    html: shell("CGM Compliance Tracker · reminders",
      `<ul style="margin:12px 0 0;padding-left:18px">${items.map((i) => `<li style="margin-bottom:4px"><a href="${esc(href(i))}" style="color:#0D1B2E">${esc(label(i))}</a></li>`).join("")}</ul>`,
      site, footerHtml(why, unsub, site)),
    text: ["CGM COMPLIANCE TRACKER · REMINDERS", "", ...items.map((i) => `* ${label(i)}  ${href(i)}`), "", ...footerText(why, unsub, site)].join("\n"),
  };
}

export function renderMessagesNotice(conversations: number, site: string, unsub: string) {
  const why = "CGM Compliance Tracker sends at most one of these a day, only when something new arrives.";
  const what = `You have unread messages in ${conversations} conversation${conversations === 1 ? "" : "s"}.`;
  return {
    subject: "You have unread messages · CGM Compliance Tracker",
    html: shell("CGM Compliance Tracker · messages", `<p style="margin:12px 0 0">${esc(what)} <a href="${esc(site)}/tracker/messages" style="color:#1747D1">Read them in the Tracker</a>.</p>`, site, footerHtml(why, unsub, site)),
    text: ["CGM COMPLIANCE TRACKER · MESSAGES", "", what, `Read them: ${site}/tracker/messages`, "", ...footerText(why, unsub, site)].join("\n"),
  };
}
