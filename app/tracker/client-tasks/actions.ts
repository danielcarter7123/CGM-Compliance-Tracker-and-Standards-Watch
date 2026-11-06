"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTracker } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";
import { CT_PARTY, CT_PRI, CT_STATUS } from "@/lib/clienttasks";
import { todayIso } from "@/lib/tasks";
import { parseLinks } from "@/lib/team";

// Client tasks run as the signed-in person. The database decides (0003 "ctasks all"): CGM staff, or the client's own
// users while their company has the Client Tasks add-on (which needs the Tracker). Repeats are scheduled by the
// database when a task is completed (spawn_next_client_task), always from the due date. Every change is logged.

const str = (f: FormData, k: string) => String(f.get(k) || "").trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FILTERS = ["client", "status", "cat", "party", "q"];

function back(params: string): never {
  revalidatePath("/tracker/client-tasks");
  redirect(`/tracker/client-tasks?${params}`);
}
const keep = (f: FormData) => {
  const p = new URLSearchParams();
  for (const k of FILTERS) { const v = str(f, `f_${k}`); if (v) p.set(k, v); }
  return p.toString();
};
const to = (f: FormData, id: string, extra: string) => [keep(f), id ? `t=${id}` : "", extra].filter(Boolean).join("&");

async function allowed() {
  const v = await requireTracker("/tracker/client-tasks");
  if (!v.isStaff && !v.products.client_tasks) redirect("/tracker");
  return v;
}

export async function saveCTask(formData: FormData) {
  const v = await allowed();
  const id = str(formData, "id");
  const again = (msg: string): never => back(to(formData, id || "new", `error=${encodeURIComponent(msg)}`));

  const title = str(formData, "title");
  if (!title) again("Name the task.");
  const company = v.isStaff ? str(formData, "company_id") : v.company?.id || "";
  if (!company) again("Choose a client.");
  const due = str(formData, "due_date"), done = str(formData, "completed_at");
  for (const d of [due, done]) if (d && !DATE.test(d)) again("Use real dates.");
  const today = todayIso();
  let status = str(formData, "status") || "notstarted";
  if (!CT_STATUS.some(([k]) => k === status)) status = "notstarted";
  if (status === "done" && done > today) again("The completed date can't be in the future.");
  let party = str(formData, "party") || "client";
  if (!CT_PARTY.some(([k]) => k === party)) party = "client";
  let priority = str(formData, "priority") || "normal";
  if (!CT_PRI.some(([k]) => k === priority)) priority = "normal";
  const n = Number(str(formData, "recur_n") || 0);
  if (!Number.isInteger(n) || n < 0 || n > 120) again("Repeats every: a whole number from 0 (one-time) to 120.");
  const unit = ["d", "m", "y"].includes(str(formData, "recur_unit")) ? str(formData, "recur_unit") : "m";
  if (n > 0 && !due) again("A repeating task needs a due date; the next one is scheduled from it.");
  const { links, refused } = parseLinks(str(formData, "links"), 10);
  if (refused.length) again(`Links must start with https:// ("${refused[0].slice(0, 60)}").`);

  const row = {
    company_id: company,
    title,
    category: str(formData, "category").slice(0, 60) || null,
    description: str(formData, "description") || null,
    assigned_to: str(formData, "assigned_to") || null,
    party,
    due_date: due || null,
    priority,
    status,
    completed_at: status === "done" ? done || today : null,
    recur_n: n,
    recur_unit: unit,
    links,
    notes: str(formData, "notes") || null,
  };
  const db = createClient();
  if (id) {
    const { data, error } = await db.from("client_tasks").update(row).eq("id", id).select("next_id");
    if (error) again(error.message);
    if (!data?.length) again("That client task wasn't found, or you can't change it.");
    back(to(formData, id, `ok=${encodeURIComponent(status === "done" && data![0].next_id && n > 0 ? "Saved. The next one is scheduled." : "Client task saved.")}`));
  }
  const newId = crypto.randomUUID();
  const { error } = await db.from("client_tasks").insert({ ...row, id: newId, created_by: v.userId });
  if (error) again(error.message);
  back(to(formData, newId, `ok=${encodeURIComponent("Client task added.")}`));
}

/** Mark complete: completed today (unless a date is already set); a repeating task schedules the next one. */
export async function completeCTask(formData: FormData) {
  await allowed();
  const id = str(formData, "id");
  const db = createClient();
  const { data, error } = await db.from("client_tasks").update({ status: "done", completed_at: todayIso() }).eq("id", id).select("next_id, recur_n");
  if (error) back(to(formData, id, `error=${encodeURIComponent(error.message)}`));
  if (!data?.length) back(to(formData, "", `error=${encodeURIComponent("That client task wasn't found, or you can't change it.")}`));
  back(to(formData, id, `ok=${encodeURIComponent(data![0].recur_n > 0 && data![0].next_id ? "Marked complete. The next one is scheduled." : "Marked complete.")}`));
}

export async function deleteCTask(formData: FormData) {
  await allowed();
  const id = str(formData, "id");
  if (formData.get("confirm") !== "on") back(to(formData, id, `error=${encodeURIComponent("Tick the box to confirm.")}`));
  const { data, error } = await createClient().from("client_tasks").delete().eq("id", id).select("id");
  if (error) back(to(formData, id, `error=${encodeURIComponent(error.message)}`));
  if (!data?.length) back(to(formData, id, `error=${encodeURIComponent("Nothing was deleted.")}`));
  back(`${keep(formData)}&ok=${encodeURIComponent("Client task deleted. The activity log keeps a record.")}`);
}

/** CGM admins: turn the add-on on for a Tracker client (the same switch as Clients › Applications). */
export async function enableClientTasks(formData: FormData) {
  const v = await allowed();
  const id = str(formData, "company_id");
  if (v.staffRole !== "admin") back(`error=${encodeURIComponent("Only CGM admins turn on Client Tasks.")}`);
  if (!id) back(`error=${encodeURIComponent("Choose a client first.")}`);
  const db = createClient();
  const { data: tr } = await db.from("entitlements").select("status").eq("company_id", id).eq("product", "tracker").maybeSingle();
  if (!tr || !["active", "trialing"].includes(tr.status as string)) back(`error=${encodeURIComponent("Client Tasks only works while the Tracker is on for that client.")}`);
  const { error } = await db.from("entitlements").upsert(
    { company_id: id, product: "client_tasks", status: "active", source: "contract", updated_at: new Date().toISOString() },
    { onConflict: "company_id,product" },
  );
  if (error) back(`error=${encodeURIComponent(error.message)}`);
  revalidatePath("/tracker/clients");
  back(`client=${id}&ok=${encodeURIComponent("Client Tasks turned on.")}`);
}
