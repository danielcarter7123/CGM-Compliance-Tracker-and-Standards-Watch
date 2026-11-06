"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTracker } from "@/lib/guards";
import { REGISTERED_FUNCTIONS } from "@/lib/functions";
import { createClient } from "@/lib/supabase/server";

// Library changes run as the signed-in person. Row level security lets only CGM project managers and admins
// write (0003 "library write" / "templates write"); these checks only give a clearer message first.

const CODE = /^[A-Z]{2,4}-[A-Z0-9.\-]+$/;

function back(params: string, path = "/tracker/standards"): never {
  revalidatePath("/tracker/standards");
  redirect(`${path}?${params}`);
}
async function editor() {
  const v = await requireTracker("/tracker/standards");
  if (!v.canApprove) back("error=" + encodeURIComponent("Only CGM project managers and admins can change the library."));
  return createClient();
}
const fail = (msg: string, open?: string): never => back(`error=${encodeURIComponent(msg)}${open ? `&open=${encodeURIComponent(open)}` : ""}`);

export async function saveStandard(formData: FormData) {
  const db = await editor();
  const isNew = formData.get("is_new") === "1";
  const code = String(formData.get("code") || "").trim().toUpperCase().replace(/\s+/g, "");
  const version = String(formData.get("version") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const family = (String(formData.get("family") || "").trim().toUpperCase() || code.split("-")[0]).slice(0, 8);
  const applies = formData.getAll("applies").map(String).filter((f) => (REGISTERED_FUNCTIONS as readonly string[]).includes(f));
  const url = String(formData.get("url") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  const again = isNew ? "new=1" : `edit=${encodeURIComponent(code)}`;

  if (!CODE.test(code)) back(`${again}&error=${encodeURIComponent("Enter the standard number like PRC-031 or BAL-001-TRE.")}`);
  if (!version) back(`${again}&error=${encodeURIComponent("Enter the version, such as 1 or 2.1.")}`);
  if (!title) back(`${again}&error=${encodeURIComponent("Enter the standard's title.")}`);
  if (url && !/^https:\/\/\S+$/i.test(url)) back(`${again}&error=${encodeURIComponent("The link must start with https://")}`);

  const row = { version, title, family, applies, url: url || null, notes: notes || null, updated_at: new Date().toISOString() };
  if (isNew) {
    const { data: exists } = await db.from("library_standards").select("code").eq("code", code).maybeSingle();
    if (exists) back(`new=1&error=${encodeURIComponent(`${code} is already in the library. Expand it to edit.`)}`);
    const { error } = await db.from("library_standards").insert({ code, custom: true, ...row });
    if (error) back(`new=1&error=${encodeURIComponent(error.message)}`);
    back(`ok=${encodeURIComponent(`${code}-${version} added to the library.`)}&open=${encodeURIComponent(code)}`);
  }
  const { error } = await db.from("library_standards").update(row).eq("code", code);
  if (error) back(`${again}&error=${encodeURIComponent(error.message)}`);
  back(`ok=${encodeURIComponent(`${code}-${version} saved.`)}&open=${encodeURIComponent(code)}`);
}

export async function saveVersion(formData: FormData) {
  const db = await editor();
  const code = String(formData.get("code"));
  const version = String(formData.get("version") || "").trim();
  if (!version) fail("Enter the version, such as 1 or 2.1.", code);
  const { error } = await db.from("library_standards").update({ version, updated_at: new Date().toISOString() }).eq("code", code);
  if (error) fail(error.message, code);
  back(`ok=${encodeURIComponent(`${code} is now version ${version}. Every link uses it.`)}&open=${encodeURIComponent(code)}`);
}

export async function saveLink(formData: FormData) {
  const db = await editor();
  const code = String(formData.get("code"));
  const reset = formData.get("reset") === "1";
  const url = reset ? null : String(formData.get("url") || "").trim();
  if (url && !/^https:\/\/\S+$/i.test(url)) fail("The link must start with https://", code);
  const { error } = await db.from("library_standards").update({ url: url || null, updated_at: new Date().toISOString() }).eq("code", code);
  if (error) fail(error.message, code);
  back(`ok=${encodeURIComponent(reset ? `${code} links to the nerc.com PDF again.` : `${code} link saved.`)}&open=${encodeURIComponent(code)}`);
}

export async function deleteStandard(formData: FormData) {
  const db = await editor();
  const code = String(formData.get("code"));
  const { count } = await db.from("tasks").select("id", { count: "exact", head: true }).eq("standard_code", code);
  if (count) back(`edit=${encodeURIComponent(code)}&error=${encodeURIComponent(`${count} task${count === 1 ? " uses" : "s use"} ${code}. Reassign or delete them first.`)}`);
  const { error } = await db.from("library_standards").delete().eq("code", code);
  if (error) back(`edit=${encodeURIComponent(code)}&error=${encodeURIComponent(error.message)}`);
  back(`ok=${encodeURIComponent(`${code} removed from the library.`)}`);
}

/** Recurrence settings: confirm each recurring obligation's "Repeat from" and, optionally, align the open
 *  repeating tasks that came from it (matched by title + standard + requirement). Due dates never change. */
export async function applyRecurrence(formData: FormData) {
  const db = await editor();
  const withTasks = formData.get("with_tasks") === "on";
  const { data: tpls, error } = await db.from("obligation_templates").select("id, standard_code, req, title, recur_n, recur_basis, basis_confirmed").gt("recur_n", 0);
  if (error) back(`error=${encodeURIComponent(error.message)}`, "/tracker/standards/recurrence");
  let nTpl = 0, nTask = 0;
  for (const t of tpls || []) {
    const v = formData.get(`basis_${t.id}`);
    if (v !== "due" && v !== "done") continue;
    if (v !== t.recur_basis || !t.basis_confirmed) {
      const { error: e } = await db.from("obligation_templates").update({ recur_basis: v, basis_confirmed: true }).eq("id", t.id);
      if (e) back(`error=${encodeURIComponent(e.message)}`, "/tracker/standards/recurrence");
      nTpl++;
    }
    if (withTasks) {
      let q = db.from("tasks").update({ recur_basis: v }, { count: "exact" })
        .neq("status", "done").gt("recur_n", 0).eq("title", t.title).eq("standard_code", t.standard_code).neq("recur_basis", v);
      q = t.req ? q.eq("requirement", t.req) : q.or("requirement.is.null,requirement.eq.");
      const { error: e, count } = await q;
      if (e) back(`error=${encodeURIComponent(e.message)}`, "/tracker/standards/recurrence");
      nTask += count || 0;
    }
  }
  revalidatePath("/tracker/standards/recurrence");
  back(`ok=${encodeURIComponent(`Recurrence settings saved: ${nTpl} obligation${nTpl === 1 ? "" : "s"} confirmed or changed${withTasks ? `, ${nTask} open task${nTask === 1 ? "" : "s"} updated` : ""}. No due dates changed.`)}`, "/tracker/standards/recurrence");
}
