// Client Tasks add-on (TRACKER-SPEC §3.7 "Client Tasks"): a client's own work outside NERC compliance. Pure helpers
// shared by the screen, the CSV export and tests. The database decides who can read and change them (0003 "ctasks all":
// CGM staff, or the client's own users while the add-on is live) and schedules repeats (spawn_next_client_task).

import type { TeamLink } from "./team";

export type CStatus = "notstarted" | "inprogress" | "onhold" | "done";
export type CTask = {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  notes: string | null;
  category: string | null;
  assigned_to: string | null;
  party: "client" | "contractor" | "cgm" | "agency" | "other";
  due_date: string | null;
  completed_at: string | null;
  priority: "low" | "normal" | "high";
  status: CStatus;
  recur_n: number;
  recur_unit: "d" | "m" | "y";
  links: TeamLink[] | null;
  created_at: string;
  created_by: string | null;
  prev_id: string | null;
  next_id: string | null;
};

export const CT_STATUS: [CStatus, string][] = [["notstarted", "Not started"], ["inprogress", "In progress"], ["onhold", "On hold"], ["done", "Complete"]];
export const CT_PARTY: [CTask["party"], string][] = [
  ["client", "Client staff"], ["contractor", "Contractor / vendor"], ["cgm", "CGM"], ["agency", "Agency / regulator"], ["other", "Other"],
];
export const CT_PRI: [CTask["priority"], string][] = [["low", "Low"], ["normal", "Normal"], ["high", "High"]];
export const CT_CATS = ["Environmental", "Health & safety", "Operations", "Maintenance", "Internal", "Regulatory (non-NERC)", "Training", "Other"];
export const CT_STATUS_FILTERS: [string, string][] = [["active", "All open"], ["overdue", "Overdue"], ["d30", "Due ≤ 30 days"], ...CT_STATUS, ["all", "All statuses"]];

const lbl = <T extends string>(arr: [T, string][], v: string | null | undefined, d = "") => arr.find(([k]) => k === v)?.[1] || d || v || "";
export const ctStatusLabel = (s: string) => lbl(CT_STATUS, s, "Not started");
export const partyLabel = (s: string) => lbl(CT_PARTY, s);
export const priorityLabel = (s: string) => lbl(CT_PRI, s || "normal");

const day = 86400e3;
const daysUntil = (due: string | null, today: string) => (due ? Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / day) : null);

/** overdue · window (due within 14 days) · done · or the status itself. */
export function ctState(t: Pick<CTask, "status" | "due_date">, today: string) {
  if (t.status === "done") return "done";
  const n = daysUntil(t.due_date, today);
  if (n !== null && n < 0) return "overdue";
  if (n !== null && n <= 14) return "window";
  return t.status;
}
export function ctWhen(t: Pick<CTask, "status" | "due_date" | "completed_at">, today: string, fmt: (d: string) => string) {
  if (t.status === "done") return t.completed_at ? `Completed ${fmt(t.completed_at)}` : "Complete";
  const n = daysUntil(t.due_date, today);
  if (n === null) return ctStatusLabel(t.status);
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} overdue`;
  if (n === 0) return "Due today";
  if (n <= 14) return `Due in ${n} day${n === 1 ? "" : "s"}`;
  return ctStatusLabel(t.status);
}
export const ctRecur = (t: Pick<CTask, "recur_n" | "recur_unit">) =>
  !t.recur_n ? "One-time" : `Every ${t.recur_n === 1 ? "" : `${t.recur_n} `}${{ d: "day", m: "month", y: "year" }[t.recur_unit] || "month"}${t.recur_n === 1 ? "" : "s"}`;

export type CFilters = { client?: string; status?: string; cat?: string; party?: string; q?: string };

/** The pilot's filters and order: open before complete, then by due date. */
export function filterCTasks(all: CTask[], f: CFilters, today: string, clientName: (id: string) => string): CTask[] {
  const status = f.status || "active", q = (f.q || "").trim().toLowerCase();
  return all
    .filter((t) => {
      if (f.client && t.company_id !== f.client) return false;
      if (status === "active" && t.status === "done") return false;
      if (status === "overdue" && ctState(t, today) !== "overdue") return false;
      if (status === "d30") {
        const n = daysUntil(t.due_date, today);
        if (t.status === "done" || n === null || n < 0 || n > 30) return false;
      }
      if (CT_STATUS.some(([k]) => k === status) && t.status !== status) return false;
      if (f.cat && t.category !== f.cat) return false;
      if (f.party && t.party !== f.party) return false;
      if (q) {
        const hay = [t.title, t.description, t.category, t.assigned_to, t.notes, clientName(t.company_id), ...(t.links || []).map((l) => `${l.label} ${l.url}`)]
          .join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.due_date || "9").localeCompare(b.due_date || "9"));
}

/** Stat strip: overdue, due within 30 days, open, completed this month (for one client or all add-on clients). */
export function ctStats(all: CTask[], today: string, client?: string) {
  const scope = all.filter((t) => !client || t.company_id === client);
  const open = scope.filter((t) => t.status !== "done");
  const monthStart = `${today.slice(0, 7)}-01`;
  return {
    overdue: open.filter((t) => ctState(t, today) === "overdue").length,
    due30: open.filter((t) => { const n = daysUntil(t.due_date, today); return n !== null && n >= 0 && n <= 30; }).length,
    open: open.length,
    doneThisMonth: scope.filter((t) => t.status === "done" && (t.completed_at || "") >= monthStart).length,
    monthStart,
  };
}

/** The pilot's client-task CSV columns. */
export function ctCsv(rows: CTask[], clientName: (id: string) => string) {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Client", "Task", "Description", "Category", "Assigned to", "Responsible party", "Due date", "Priority", "Status", "Completed", "Repeats", "Links", "Notes"];
  const lines = rows.map((t) =>
    [clientName(t.company_id), t.title, t.description, t.category, t.assigned_to, partyLabel(t.party), t.due_date, priorityLabel(t.priority),
      ctStatusLabel(t.status), t.completed_at, ctRecur(t), (t.links || []).map((l) => (l.label ? `${l.label}: ${l.url}` : l.url)).join(" | "), t.notes]
      .map(q).join(","),
  );
  return [head.map(q).join(","), ...lines].join("\r\n");
}
