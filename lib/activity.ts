// Activity Log (TRACKER-SPEC §3.11): turning log entries into readable rows and CSV. Pure helpers, tested.
// The database writes the log (triggers only) and decides who can read which entries.

export type LogEntry = {
  id: number;
  at: string;
  actor_id: string | null;
  action: string;
  kind: string;
  target_id: string;
  company_id: string | null;
  label: string | null;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  source: "app" | "legacy";
  legacy: { by?: string; note?: string; changes?: { f: string; from: unknown; to: unknown }[]; clientName?: string; restoredAt?: string } | null;
  ref_id: number | null;
};
export type Change = { field: string; from: string; to: string };

export const KIND_LABEL: Record<string, string> = {
  task: "Task", team: "Team task", ctask: "Client task", client: "Client", standard: "Standard", plan: "Task plan",
  entitlement: "Product", contact: "Contact", evidence: "Evidence", export: "Export", outlook: "Outlook reminder",
};
/** Record types for the filter. Clients only ever see their tasks, client tasks and evidence. */
export const KIND_FILTERS = (staff: boolean): [string, string][] =>
  staff
    ? [["task", "Tasks"], ["team", "Team tasks"], ["ctask", "Client tasks"], ["client", "Clients"], ["standard", "Standards"], ["plan", "Task plans"],
       ["entitlement", "Products"], ["contact", "Contacts"], ["evidence", "Evidence"], ["outlook", "Outlook reminders"], ["export", "Exports"]]
    : [["task", "Tasks"], ["ctask", "Client tasks"], ["evidence", "Evidence"]];

export const ACTION_LABEL: Record<string, string> = {
  created: "Created", updated: "Updated", deleted: "Deleted", performed: "Performed", approved: "Approved", completed: "Completed",
  sent_back: "Sent back", restored: "Restored", reverted: "Reverted", exported: "Exported", "reminders added": "Reminders added",
};
export const RANGES: [string, string][] = [["1", "Last 24 hours"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["365", "Last 365 days"], ["all", "All time"]];

const FIELD_LABEL: Record<string, string> = {
  title: "Title", name: "Name", due_date: "Due date", status: "Status", assignee_text: "Assignee", assignee_id: "Assignee", facility: "Facility / unit",
  standard_code: "Standard", requirement: "Requirement", remind_days: "Reminders (days before)", recur_n: "Repeats every", recur_unit: "Repeat unit",
  recur_basis: "Repeat from", evidence: "Evidence", notes: "Notes", completed_at: "Performed on", performed_by: "Performed by",
  reviewed_at: "Approved on", reviewed_by: "Approved by", company_id: "Client", owner_id: "Assigned to", collaborators: "Collaborators",
  planned_date: "Anticipated completion", actual_date: "Actual completion", est_hours: "Estimated hours", description: "Description", links: "Links",
  pm_id: "Project manager", product: "Product", source: "Billing", email: "Email", kind: "Kind", digest: "Gets the digest",
  // The pilot's own field names, in its history.
  std: "Standard", req: "Requirement", client_id: "Client", owner: "Assigned to", assignee: "Assignee", recur: "Repeats", remind: "Reminders",
  done_date: "Performed on", completed_date: "Performed on", planned: "Anticipated completion", actual: "Actual completion",
};
const snake = (f: string) => f.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
// Bookkeeping fields that never help a reader.
const HIDDEN = new Set(["id", "created_at", "created_by", "updated_at", "legacy", "legacy_id", "prev_id", "next_id", "copied_from", "sample",
  "owner_legacy", "created_by_legacy", "collaborators_legacy", "owner_email", "plan_id", "stripe_subscription_id"]);
const PEOPLE = new Set(["assignee_id", "performed_by", "reviewed_by", "owner_id", "pm_id", "user_id", "added_by", "removed_by"]);
const STATUS: Record<string, string> = {
  open: "Open", inprogress: "In progress", review: "Performed, pending review", done: "Complete", notstarted: "Not started", onhold: "On hold",
};

export const fieldLabel = (f: string) => FIELD_LABEL[f] || f.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const clip = (s: string) => (s.length > 300 ? `${s.slice(0, 297)}…` : s);

export type Ctx = { personName: (id: string) => string; clientName: (id: string) => string };

function show(field: string, v: unknown, ctx: Ctx): string {
  if (v === null || v === undefined || v === "") return "";
  if (PEOPLE.has(field) && typeof v === "string") return ctx.personName(v);
  if (field === "company_id" && typeof v === "string") return ctx.clientName(v);
  if (field === "collaborators" && Array.isArray(v)) return v.map((x) => ctx.personName(String(x))).join(", ");
  if (field === "status" && typeof v === "string") return STATUS[v] || v;
  if (field === "links" && Array.isArray(v)) return v.map((l: { label?: string; url?: string }) => (l.label ? `${l.label}: ${l.url}` : l.url)).join(" | ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Field changes for an entry: from the stored before/after rows, or the pilot's recorded changes. At most 40. */
export function changes(e: LogEntry, ctx: Ctx): Change[] {
  if (e.source === "legacy") {
    return (e.legacy?.changes || []).slice(0, 40).map((c) => ({ field: fieldLabel(snake(String(c.f))), from: clip(String(c.from ?? "")), to: clip(String(c.to ?? "")) }));
  }
  if (!e.old_row || !e.new_row) return [];
  const keys = [...new Set([...Object.keys(e.old_row), ...Object.keys(e.new_row)])].filter((k) => !HIDDEN.has(k));
  return keys
    .filter((k) => JSON.stringify(e.old_row![k] ?? null) !== JSON.stringify(e.new_row![k] ?? null))
    .slice(0, 40)
    .map((k) => ({ field: fieldLabel(k), from: clip(show(k, e.old_row![k], ctx)), to: clip(show(k, e.new_row![k], ctx)) }));
}

/** Restore and Revert are offered for this app's own entries (the database checks again). */
export const canRestore = (e: LogEntry) => e.source === "app" && e.action === "deleted" && !!e.old_row && e.kind !== "export";
export const canRevert = (e: LogEntry) => e.source === "app" && !!e.old_row && !!e.new_row && e.action !== "created" && e.action !== "deleted";

/** CSV: one row per field change (an entry without changes still gets one row). */
export function activityCsv(rows: LogEntry[], ctx: Ctx & { who: (e: LogEntry) => string; client: (e: LogEntry) => string }) {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["When", "Who", "Action", "Record type", "Record", "Client", "Field", "From", "To", "Note"];
  const lines: string[] = [];
  for (const e of rows) {
    const base = [e.at, ctx.who(e), ACTION_LABEL[e.action] || e.action, KIND_LABEL[e.kind] || e.kind, e.label, ctx.client(e)];
    const cs = changes(e, ctx);
    const note = e.legacy?.note || "";
    if (!cs.length) lines.push([...base, "", "", "", note].map(q).join(","));
    for (const c of cs) lines.push([...base, c.field, c.from, c.to, note].map(q).join(","));
  }
  return [head.map(q).join(","), ...lines].join("\r\n");
}
