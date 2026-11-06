import { daysUntil, fmt, parseDate, startOfToday } from "./watch";

/* NERC compliance tasks: the pilot's derived states, filters, reminders and CSV, as pure functions.
   The database is the authority for what changes (guard_task_update, spawn_next_occurrence, next_due);
   nextDuePreview only shows the next due date ahead of time and is tested against SQL next_due. */

export type TaskStatus = "open" | "inprogress" | "review" | "done";
export type Task = {
  id: string;
  company_id: string;
  title: string;
  facility: string | null;
  standard_code: string | null;
  requirement: string | null;
  due_date: string | null;
  assignee_text: string | null;
  remind_days: number[];
  recur_n: number;
  recur_unit: "d" | "m" | "y";
  recur_basis: "due" | "done";
  status: TaskStatus;
  evidence: string | null;
  notes: string | null;
  completed_at: string | null;
  performed_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  prev_id: string | null;
  next_id: string | null;
  copied_from: string | null;
  sample: boolean;
  /** Set by markEvidence: at least one evidence item (upload or link) that hasn't been removed. */
  has_evidence?: boolean;
};

export type State = "done" | "review" | "nodate" | "overdue" | "window" | "inprogress" | "scheduled";
export const STATE_LABEL: Record<State, string> = {
  review: "Pending review", nodate: "Needs due date", overdue: "Overdue", window: "Reminder active",
  scheduled: "Scheduled", inprogress: "In progress", done: "Complete",
};
export const REMIND_OFFSETS = [90, 60, 30, 14, 7, 1] as const;

export const isLink = (s: string | null | undefined) => !!s && /^https:\/\/\S+$/i.test(s.trim());
/** An https link in evidence counts as the report being posted. */
/** "Report posted": the task's evidence link (the pilot's rule), or any evidence item that hasn't been removed. */
export const hasReport = (t: Pick<Task, "evidence" | "has_evidence">) => isLink(t.evidence) || !!t.has_evidence;

export function taskState(t: Pick<Task, "status" | "due_date" | "remind_days">, today = startOfToday()): State {
  if (t.status === "done") return "done";
  if (t.status === "review") return "review";
  if (!t.due_date) return "nodate";
  const n = daysUntil(t.due_date, today);
  if (n < 0) return "overdue";
  if (n <= Math.max(0, ...(t.remind_days || []))) return "window";
  return t.status === "inprogress" ? "inprogress" : "scheduled";
}

/** The pill class and text, including the pilot's "report pending" variant of Pending review. */
export function pill(t: Task, today = startOfToday()) {
  const st = taskState(t, today);
  const reportDue = st === "review" && !hasReport(t);
  return { cls: reportDue ? "reportdue" : st, label: STATE_LABEL[st], reportDue };
}

export function whenText(t: Task, today = startOfToday()) {
  if (t.status === "done") return `Completed ${fmt(t.completed_at)}`;
  if (t.status === "review") {
    const d = t.completed_at ? -daysUntil(t.completed_at, today) : null;
    return `Performed ${fmt(t.completed_at)}${hasReport(t) ? " · awaiting approval" : d !== null && d >= 0 ? ` · report pending ${d} day${d === 1 ? "" : "s"}` : " · report pending"}`;
  }
  if (!t.due_date) return "No due date";
  const n = daysUntil(t.due_date, today);
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} overdue`;
  if (n === 0) return "Due today";
  return `Due in ${n} day${n === 1 ? "" : "s"}`;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (s: string, n: number) => { const d = parseDate(s); d.setDate(d.getDate() + n); return iso(d); };
export const todayIso = (today = startOfToday()) => iso(today);

/** The next reminder date: the earliest offset whose date hasn't passed. */
export function nextReminder(t: Pick<Task, "status" | "due_date" | "remind_days">, today = startOfToday()) {
  if (t.status === "done" || !t.due_date) return null;
  for (const o of [...(t.remind_days || [])].sort((a, b) => b - a)) {
    const d = addDays(t.due_date, -o);
    if (daysUntil(d, today) >= 0) return { date: d, offset: o };
  }
  return null;
}

/** Preview of SQL public.next_due: months add calendar months clamped to month end; years fall due Dec 31 of
 *  the year N years later; days add days. Keep in step with 0003_tracker.sql (tests compare the two). */
export function nextDuePreview(base: string, n: number, unit: "d" | "m" | "y"): string {
  const [y, m, d] = base.split("-").map(Number);
  if (unit === "d") return addDays(base, n);
  if (unit === "y") return `${y + n}-12-31`;
  const total = m - 1 + n;
  const ny = y + Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function recurText(t: Pick<Task, "recur_n" | "recur_unit" | "recur_basis">) {
  if (!t.recur_n) return "One-time";
  const u = t.recur_unit === "d" ? (t.recur_n === 1 ? "day" : "days") : t.recur_unit === "y" ? (t.recur_n === 1 ? "calendar year" : "calendar years") : (t.recur_n === 1 ? "month" : "months");
  return `Every ${t.recur_n} ${u}${t.recur_basis === "done" ? " from completion" : ""}`;
}

/** The pilot's default reminders: [30, 7], or [7, 1] for day-based intervals. */
export const defaultReminders = (unit: "d" | "m" | "y") => (unit === "d" ? [7, 1] : [30, 7]);

export type Filter = { q?: string; status?: string; client?: string; std?: string; fn?: string };
export const STATUS_FILTERS: [key: string, label: string][] = [
  ["open", "All open"], ["window", "Reminders active"], ["nodate", "Needs due date"], ["review", "Pending review"],
  ["noreport", "Report not posted"], ["overdue", "Overdue"], ["d30", "Due ≤ 30 days"], ["done", "Completed"], ["all", "All tasks"],
];

/** The pilot's Tasks filters and sort: by due date with no date last; Completed sorts by completion, newest first. */
export function filterTasks(
  rows: Task[],
  f: Filter,
  lookup: { clientName: (id: string) => string; applies: (code: string | null) => string[] },
  today = startOfToday(),
): Task[] {
  const q = (f.q || "").trim().toLowerCase();
  const status = f.status || "open";
  return rows
    .filter((t) => {
      const st = taskState(t, today);
      if (status === "open" && t.status === "done") return false;
      if (status === "overdue" && st !== "overdue") return false;
      if (status === "d30") {
        if (t.status === "review" || t.status === "done" || !t.due_date) return false;
        const n = daysUntil(t.due_date, today);
        if (n < 0 || n > 30) return false;
      }
      if (status === "window" && st !== "overdue" && st !== "window") return false;
      if (status === "done" && t.status !== "done") return false;
      if (status === "nodate" && (t.status === "done" || t.due_date)) return false;
      if (status === "review" && t.status !== "review") return false;
      if (status === "noreport" && !(t.status === "review" && !hasReport(t))) return false;
      if (f.client && t.company_id !== f.client) return false;
      if (f.std && t.standard_code !== f.std) return false;
      if (f.fn && !lookup.applies(t.standard_code).includes(f.fn)) return false;
      if (q) {
        const hay = [t.title, t.standard_code, t.requirement, t.facility, t.assignee_text, t.notes, lookup.clientName(t.company_id)].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) =>
      status === "done"
        ? (b.completed_at || "").localeCompare(a.completed_at || "")
        : (a.due_date || "9").localeCompare(b.due_date || "9") || a.title.localeCompare(b.title),
    );
}

/** The pilot's CSV export columns. */
export function tasksCsv(
  rows: Task[],
  lookup: { client: (id: string) => { name: string; ncr_id: string | null } | undefined; version: (code: string | null) => string },
  today = startOfToday(),
) {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Client", "NCR ID", "Standard", "Version", "Requirement", "Task", "Facility", "Assignee", "Due date", "Status", "Repeats", "Completed", "Evidence", "Notes"];
  const lines = rows.map((t) => {
    const c = lookup.client(t.company_id);
    return [c?.name, c?.ncr_id, t.standard_code, lookup.version(t.standard_code), t.requirement, t.title, t.facility, t.assignee_text,
      t.due_date, STATE_LABEL[taskState(t, today)], recurText(t), t.completed_at, t.evidence, t.notes].map(q).join(",");
  });
  return [head.map(q).join(","), ...lines].join("\r\n");
}

/** The pilot's "task set" key: one representative per distinct title + standard + requirement. */
export const taskKey = (t: { title: string; standard_code: string | null; requirement: string | null }) =>
  `${t.title.trim().toLowerCase()}|${t.standard_code || ""}|${(t.requirement || "").trim().toLowerCase()}`;
