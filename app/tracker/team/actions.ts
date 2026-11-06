"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/tasks";
import { TEAM_STATUS, parseLinks } from "@/lib/team";

// Team tasks are CGM's internal work. They run as the signed-in person; the database lets only CGM staff
// read or change them (0003 "team staff"), and the activity log records every change by trigger.

const str = (f: FormData, k: string) => String(f.get(k) || "").trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function back(params: string): never {
  revalidatePath("/tracker/team");
  redirect(`/tracker/team?${params}`);
}
const keep = (f: FormData) => {
  const p = new URLSearchParams();
  for (const k of ["scope", "status", "client", "q"]) { const v = str(f, `f_${k}`); if (v) p.set(k, v); }
  return p.toString();
};
const to = (f: FormData, id: string, extra: string) => [keep(f), id ? `t=${id}` : "", extra].filter(Boolean).join("&");

export async function saveTeamTask(formData: FormData) {
  const v = await requireStaff("/tracker/team");
  const id = str(formData, "id");
  const again = (msg: string): never => back(to(formData, id || "new", `error=${encodeURIComponent(msg)}`));

  const title = str(formData, "title");
  if (!title) again("Name the task.");
  const planned = str(formData, "planned_date"), actual = str(formData, "actual_date");
  for (const d of [planned, actual]) if (d && !DATE.test(d)) again("Use real dates.");
  const today = todayIso();
  if (actual && actual > today) again("The actual completion date can't be in the future.");
  let status = str(formData, "status") || "notstarted";
  if (!TEAM_STATUS.some(([k]) => k === status)) status = "notstarted";
  const hoursRaw = str(formData, "est_hours");
  const est = hoursRaw === "" ? null : Number(hoursRaw);
  if (est !== null && (!Number.isFinite(est) || est < 0 || est > 9999 || Math.round(est * 4) !== est * 4)) again("Estimated hours go in steps of 0.25.");
  const { links, refused } = parseLinks(str(formData, "links"));
  if (refused.length) again(`Links must start with https:// ("${refused[0].slice(0, 60)}").`);
  const owner = str(formData, "owner_id") === "me" ? v.userId : str(formData, "owner_id") || null;
  const collaborators = [...new Set(formData.getAll("collaborators").map(String).filter(Boolean))].filter((c) => c !== owner);

  const row = {
    title,
    description: str(formData, "description") || null,
    company_id: str(formData, "company_id") || null,
    owner_id: owner,
    collaborators,
    planned_date: planned || null,
    // Marked complete with no date: the actual completion is today.
    actual_date: actual || (status === "done" ? today : null),
    est_hours: est,
    status,
    links,
  };
  const db = createClient();
  if (id) {
    const { error } = await db.from("team_tasks").update(row).eq("id", id);
    if (error) again(error.message);
    back(to(formData, id, `ok=${encodeURIComponent("Team task saved.")}`));
  }
  const newId = crypto.randomUUID();
  const { error } = await db.from("team_tasks").insert({ ...row, id: newId, created_by: v.userId });
  if (error) again(error.message);
  back(to(formData, newId, `ok=${encodeURIComponent("Team task added.")}`));
}

/** Mark complete: status Complete, actual completion today unless one is already set. */
export async function completeTeamTask(formData: FormData) {
  await requireStaff("/tracker/team");
  const id = str(formData, "id");
  const db = createClient();
  const { data: t } = await db.from("team_tasks").select("actual_date").eq("id", id).maybeSingle();
  if (!t) back(to(formData, "", `error=${encodeURIComponent("That team task wasn't found.")}`));
  const { error } = await db.from("team_tasks").update({ status: "done", actual_date: t.actual_date || todayIso() }).eq("id", id);
  if (error) back(to(formData, id, `error=${encodeURIComponent(error.message)}`));
  back(to(formData, id, `ok=${encodeURIComponent("Marked complete.")}`));
}

export async function deleteTeamTask(formData: FormData) {
  await requireStaff("/tracker/team");
  const id = str(formData, "id");
  if (formData.get("confirm") !== "on") back(to(formData, id, `error=${encodeURIComponent("Tick the box to confirm.")}`));
  const { error } = await createClient().from("team_tasks").delete().eq("id", id);
  if (error) back(to(formData, id, `error=${encodeURIComponent(error.message)}`));
  back(`${keep(formData)}&ok=${encodeURIComponent("Team task deleted. The activity log keeps a record.")}`);
}
