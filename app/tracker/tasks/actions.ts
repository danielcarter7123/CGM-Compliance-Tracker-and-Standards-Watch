"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTracker } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";
import { REMIND_OFFSETS, defaultReminders, isLink, nextDuePreview, taskKey, todayIso } from "@/lib/tasks";

// Task changes run as the signed-in person. The database decides (0003 + guard_task_update):
// staff create and edit tasks; client users only mark performed and post evidence and notes;
// only CGM project managers and admins approve. A refusal comes back as the database's own message.

const str = (f: FormData, k: string) => String(f.get(k) || "").trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function back(params: string, path = "/tracker/tasks"): never {
  revalidatePath("/tracker/tasks");
  revalidatePath("/tracker");
  redirect(`${path}?${params}`);
}
const keep = (f: FormData) => {
  const p = new URLSearchParams();
  for (const k of ["q", "status", "client", "std", "fn"]) { const v = str(f, `f_${k}`); if (v) p.set(k, v); }
  return p.toString();
};
const to = (f: FormData, id: string, extra: string) => [keep(f), id ? `t=${id}` : "", extra].filter(Boolean).join("&");

export async function saveTask(formData: FormData) {
  const v = await requireTracker("/tracker/tasks");
  const id = str(formData, "id");
  const again = (msg: string): never => back(to(formData, id || "new", `error=${encodeURIComponent(msg)}`));
  if (!v.isStaff) again("Only CGM staff create and edit tasks. You can mark a task performed and post evidence.");

  const row = {
    company_id: str(formData, "company_id"),
    title: str(formData, "title"),
    facility: str(formData, "facility") || null,
    standard_code: str(formData, "standard_code") || null,
    requirement: str(formData, "requirement") || null,
    due_date: str(formData, "due_date") || null,
    assignee_text: str(formData, "assignee_text") || null,
    remind_days: formData.getAll("remind_days").map(Number).filter((n) => (REMIND_OFFSETS as readonly number[]).includes(n)).sort((a, b) => b - a),
    recur_n: Math.max(0, Math.min(600, parseInt(str(formData, "recur_n") || "0", 10) || 0)),
    recur_unit: (["d", "m", "y"].includes(str(formData, "recur_unit")) ? str(formData, "recur_unit") : "m") as "d" | "m" | "y",
    recur_basis: str(formData, "recur_basis") === "done" ? "done" : "due",
    evidence: str(formData, "evidence") || null,
    notes: str(formData, "notes") || null,
  };
  const status = str(formData, "status");
  if (!row.title) again("Enter the task.");
  if (!row.company_id) again("Choose the client.");
  if (!row.due_date) again("Set the due date so reminders and digests can track this task.");
  if (row.due_date && !DATE.test(row.due_date)) again("Enter the due date as a date.");
  if (row.evidence && /^http:\/\//i.test(row.evidence)) again("Evidence links must start with https://");

  const db = createClient();
  if (id) {
    const update: Record<string, unknown> = { ...row };
    if (["open", "inprogress", "review", "done"].includes(status)) update.status = status;
    // A PM correcting the performed date (checked against the report). Never a future date.
    const performed = str(formData, "completed_at");
    const { data: before } = await db.from("tasks").select("completed_at, next_id").eq("id", id).maybeSingle();
    if (performed) {
      if (!DATE.test(performed)) again("Enter the performed date as a date.");
      if (performed > todayIso()) again("The performed date can't be in the future.");
      update.completed_at = performed;
    }
    const { error } = await db.from("tasks").update(update).eq("id", id);
    if (error) again(error.message);
    // Repeating from completion: move the still-open next occurrence to match (date math in SQL next_due).
    let moved = "";
    if (performed && before && performed !== before.completed_at && row.recur_basis === "done" && row.recur_n > 0 && before.next_id) {
      const { data: nextDue, error: e1 } = await db.rpc("next_due", { base: performed, n: row.recur_n, unit: row.recur_unit });
      if (e1) again(e1.message);
      const { data: nt, error: e2 } = await db.from("tasks").update({ due_date: nextDue }).eq("id", before.next_id).in("status", ["open", "inprogress"]).select("id");
      if (e2) again(e2.message);
      if (nt?.length) moved = ` The next occurrence is now due ${nextDue}.`;
    }
    back(to(formData, id, `ok=${encodeURIComponent(`Task saved.${moved}`)}`));
  }
  const { data, error } = await db.from("tasks").insert({ ...row, status: status === "inprogress" ? "inprogress" : "open", created_by: v.userId }).select("id").single();
  if (error || !data) return again(error?.message || "Couldn't add the task.");
  back(to(formData, data.id as string, `ok=${encodeURIComponent("Task added.")}`));
}

/** "Close out task" (the pilot's "Mark performed"): performed counts for compliance. The date is the date the
 *  work was performed, confirmed by the person (it may be backdated; reports often arrive weeks later); the database records who and when and, for a
 *  repeating task, creates the next occurrence right away. Client users can do this for their own tasks. */
export async function markPerformed(formData: FormData) {
  await requireTracker("/tracker/tasks");
  const id = str(formData, "id");
  const date = str(formData, "performed_on");
  const evidence = str(formData, "evidence");
  const err = (msg: string) => back(to(formData, id, `error=${encodeURIComponent(msg)}`));
  if (!DATE.test(date)) err("Enter the date the work was performed.");
  if (date > todayIso()) err("The performed date can't be in the future.");
  if (formData.get("confirm_date") !== "on") err("Check the date the work was performed (not the date the report arrived), then tick the box to confirm it.");
  if (evidence && !isLink(evidence) && /^http:/i.test(evidence)) err("Evidence links must start with https://");
  const update: Record<string, unknown> = { status: "review", completed_at: date };
  if (evidence) update.evidence = evidence;
  const db = createClient();
  const { error } = await db.from("tasks").update(update).eq("id", id);
  if (error) err(error.message);
  const { data: t } = await db.from("tasks").select("next_id").eq("id", id).maybeSingle();
  back(to(formData, id, `ok=${encodeURIComponent(`Closed out as performed on ${date}.${t?.next_id ? " The next occurrence is scheduled." : ""} A CGM project manager will review it.`)}`));
}

/** "Approve & close": CGM project managers and admins (the database refuses anyone else). */
export async function approveTask(formData: FormData) {
  await requireTracker("/tracker/tasks");
  const id = str(formData, "id");
  const db = createClient();
  const { data: t } = await db.from("tasks").select("evidence").eq("id", id).maybeSingle();
  const { count: items } = await db.from("evidence").select("id", { count: "exact", head: true }).eq("task_id", id).is("removed_at", null);
  if (t && !isLink(t.evidence) && !items && formData.get("no_report") !== "on") {
    back(to(formData, id, `error=${encodeURIComponent("No report or evidence is posted. Tick \"Approve without a report link\" to close it anyway.")}`));
  }
  const { error } = await db.from("tasks").update({ status: "done" }).eq("id", id);
  if (error) back(to(formData, id, `error=${encodeURIComponent(error.message)}`));
  back(to(formData, id, `ok=${encodeURIComponent("Approved and closed.")}`));
}

/** "Send back": back to open, performed details cleared. */
export async function sendBack(formData: FormData) {
  await requireTracker("/tracker/tasks");
  const id = str(formData, "id");
  const { error } = await createClient().from("tasks").update({ status: "open" }).eq("id", id);
  if (error) back(to(formData, id, `error=${encodeURIComponent(error.message)}`));
  back(to(formData, id, `ok=${encodeURIComponent("Sent back. The task is open again.")}`));
}

/** Evidence and notes: anyone who can see the task (client users included). */
export async function saveEvidenceNotes(formData: FormData) {
  await requireTracker("/tracker/tasks");
  const id = str(formData, "id");
  const evidence = str(formData, "evidence") || null;
  if (evidence && /^http:\/\//i.test(evidence)) back(to(formData, id, `error=${encodeURIComponent("Evidence links must start with https://")}`));
  const { error } = await createClient().from("tasks").update({ evidence, notes: str(formData, "notes") || null }).eq("id", id);
  if (error) back(to(formData, id, `error=${encodeURIComponent(error.message)}`));
  back(to(formData, id, `ok=${encodeURIComponent("Saved.")}`));
}

export async function deleteTask(formData: FormData) {
  const v = await requireTracker("/tracker/tasks");
  const id = str(formData, "id");
  if (!v.isStaff) back(to(formData, id, `error=${encodeURIComponent("Only CGM staff delete tasks.")}`));
  if (formData.get("confirm") !== "on") back(to(formData, id, `error=${encodeURIComponent("Tick the box to confirm.")}`));
  const { error } = await createClient().from("tasks").delete().eq("id", id);
  if (error) back(to(formData, id, `error=${encodeURIComponent(error.message)}`));
  back(`${keep(formData)}&ok=${encodeURIComponent("Task deleted. The activity log keeps a record.")}`);
}

/** Library: "Create all recurring tasks for client" for one standard. Due dates are one interval from today;
 *  adjust them to the last completed date. */
export async function createAllForClient(formData: FormData) {
  const v = await requireTracker("/tracker/standards");
  const code = str(formData, "standard_code");
  const companyId = str(formData, "company_id");
  const toLib = (p: string) => back(`open=${encodeURIComponent(code)}&${p}`, "/tracker/standards");
  if (!v.isStaff) toLib(`error=${encodeURIComponent("Only CGM staff create tasks.")}`);
  if (!companyId) toLib(`error=${encodeURIComponent("Choose the client first.")}`);
  const db = createClient();
  const { data: tpls, error } = await db.from("obligation_templates").select("req, title, recur_n, recur_unit, recur_basis").eq("standard_code", code).gt("recur_n", 0).order("pos");
  if (error) toLib(`error=${encodeURIComponent(error.message)}`);
  const today = todayIso();
  const rows = (tpls || []).map((t) => ({
    company_id: companyId, title: t.title, standard_code: code, requirement: t.req || null,
    due_date: nextDuePreview(today, t.recur_n, t.recur_unit), remind_days: defaultReminders(t.recur_unit),
    recur_n: t.recur_n, recur_unit: t.recur_unit, recur_basis: t.recur_basis, status: "open", created_by: v.userId,
  }));
  if (!rows.length) toLib(`error=${encodeURIComponent("This standard has no recurring obligations.")}`);
  const { error: e } = await db.from("tasks").insert(rows);
  if (e) toLib(`error=${encodeURIComponent(e.message)}`);
  toLib(`ok=${encodeURIComponent(`Created ${rows.length} recurring task${rows.length === 1 ? "" : "s"} for the client, due one interval from today. Adjust each to the last completed date.`)}`);
}

/** Clients: "Assign all tracker tasks" / "Add missing tasks". Copies one representative of every distinct open,
 *  non-sample task in the tracker (title + standard + requirement) the client doesn't have yet, with no due date. */
export async function addMissingTasks(formData: FormData) {
  const v = await requireTracker("/tracker/clients");
  const companyId = str(formData, "company_id");
  const toClient = (p: string) => back(`c=${companyId}&${p}`, "/tracker/clients");
  if (!v.isStaff) toClient(`error=${encodeURIComponent("Only CGM staff assign tasks.")}`);
  const db = createClient();
  const [{ data: open, error }, { data: contact }] = await Promise.all([
    db.from("tasks").select("id, company_id, title, facility, standard_code, requirement, remind_days, recur_n, recur_unit, recur_basis, plan_id, sample, status").neq("status", "done").eq("sample", false),
    db.from("contacts").select("name").eq("company_id", companyId).eq("kind", "compliance").maybeSingle(),
  ]);
  if (error) toClient(`error=${encodeURIComponent(error.message)}`);
  const have = new Set((open || []).filter((t) => t.company_id === companyId).map(taskKey));
  const seen = new Set<string>();
  const rows = [];
  for (const t of open || []) {
    if (t.company_id === companyId) continue;
    const k = taskKey(t);
    if (have.has(k) || seen.has(k)) continue;
    seen.add(k);
    rows.push({
      company_id: companyId, title: t.title, standard_code: t.standard_code, requirement: t.requirement,
      due_date: null, assignee_text: contact?.name || null, remind_days: t.remind_days, recur_n: t.recur_n, recur_unit: t.recur_unit,
      recur_basis: t.recur_basis, plan_id: t.plan_id, status: "open", copied_from: t.id, created_by: v.userId,
    });
  }
  if (!rows.length) toClient(`ok=${encodeURIComponent("This client already has every task in the tracker.")}`);
  const { error: e } = await db.from("tasks").insert(rows);
  if (e) toClient(`error=${encodeURIComponent(e.message)}`);
  back(`client=${companyId}&status=nodate&ok=${encodeURIComponent(`Added ${rows.length} task${rows.length === 1 ? "" : "s"} without due dates. Set each due date so reminders and digests can track it.`)}`);
}
