"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/guards";
import { legacyRows } from "@/lib/legacy-restore";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/tasks";

// Restore and Revert run in the database (0014: restore_entry, revert_entry) as the signed-in person. Both write
// ordinary, logged changes ("restored", "reverted"); the log itself is never edited.

const str = (f: FormData, k: string) => String(f.get(k) || "").trim();
const keep = (f: FormData) => {
  const p = new URLSearchParams();
  for (const k of ["range", "who", "kind", "client", "q", "n"]) { const v = str(f, `f_${k}`); if (v) p.set(k, v); }
  return p.toString();
};
function back(f: FormData, extra: string): never {
  revalidatePath("/tracker", "layout");
  redirect(`/tracker/activity?${[keep(f), extra].filter(Boolean).join("&")}`);
}

export async function restoreEntry(formData: FormData) {
  await requireStaff("/tracker/activity");
  const id = Number(str(formData, "id"));
  const db = createClient();
  const { data: e } = await db.from("activity_log").select("kind, source, legacy").eq("id", id).maybeSingle();
  if (!e) back(formData, `error=${encodeURIComponent("That entry wasn't found.")}`);
  if (e.source === "legacy") {
    // Deleted in the pilot before the move: rebuild the rows from its saved copy with the importer's mapping.
    const rows = await legacyRows(db, { kind: e.kind as string, legacy: e.legacy as Record<string, unknown> | null }, todayIso());
    if (typeof rows === "string") back(formData, `error=${encodeURIComponent(rows)}`);
    const { error } = await db.rpc("restore_legacy", { p_id: id, p_rows: rows });
    if (error) back(formData, `error=${encodeURIComponent(error.message)}`);
  } else {
    const { error } = await db.rpc("restore_entry", { p_id: id });
    if (error) back(formData, `error=${encodeURIComponent(error.message)}`);
  }
  back(formData, `ok=${encodeURIComponent(`Restored “${str(formData, "label")}”. The log records the restore.`)}`);
}

export async function revertEntry(formData: FormData) {
  await requireStaff("/tracker/activity");
  const id = Number(str(formData, "id"));
  const force = formData.get("force") === "1";
  const { data, error } = await createClient().rpc("revert_entry", { p_id: id, p_force: force });
  if (error) back(formData, `error=${encodeURIComponent(error.message)}`);
  if (data) back(formData, `confirm=${id}&since=${encodeURIComponent(String(data))}`);
  back(formData, `ok=${encodeURIComponent(`Reverted the change to “${str(formData, "label")}”. The log records the revert.`)}`);
}
