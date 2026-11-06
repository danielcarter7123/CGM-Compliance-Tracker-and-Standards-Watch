import "server-only";
import { mapClient, mapStandard, mapTask, standardOf, uuidFrom, type Row } from "./legacy-map";
import type { createClient } from "./supabase/server";

type Db = ReturnType<typeof createClient>;
export type Restorable = { kind: string; row: Row }[];

/** Turns the pilot's saved copy of a deleted record into the rows the importer would have made, ready for
 *  restore_legacy (0016). Reads as the signed-in person (staff can read the saved copies). Returns a message
 *  instead when it can't be restored. */
export async function legacyRows(db: Db, entry: { kind: string; legacy: Record<string, any> | null }, today: string): Promise<Restorable | string> {
  const entryId = entry.legacy?.entryId;
  if (!entryId || !entry.legacy?.hasSnap) return "There's no saved copy of this record.";
  const { data: snapRow } = await db.from("legacy_snapshots").select("snap").eq("entry_id", entryId).maybeSingle();
  const snap = snapRow?.snap as { data?: any; tasks?: any[] } | undefined;
  if (!snap?.data) return "There's no saved copy of this record.";
  const now = new Date().toISOString();

  const { data: lib } = await db.from("library_standards").select("code");
  const codes = new Set((lib || []).map((s) => s.code as string));
  const taskRows = async (tasks: any[], companyFor: (t: any) => string | null): Promise<Restorable | string> => {
    const out: Restorable = [];
    for (const t of tasks) {
      if (!t?.id) return "A saved task has no id, so it can't be restored safely.";
      const companyId = companyFor(t);
      if (!companyId) return "Restore its client first: the client this task belonged to isn't in the app.";
      const std = standardOf(t);
      const row = mapTask(String(t.id), t, { companyId, standard: std && codes.has(std) ? std : null, today, exportedAt: now });
      const link = (v: unknown) => (typeof v === "string" && v ? uuidFrom("task", v) : null);
      out.push({ kind: "task", row: { ...row, prev_id: link(t.prevId), next_id: link(t.nextId), copied_from: link(t.copiedFrom) } });
    }
    return out;
  };

  if (entry.kind === "task") {
    const clientId = typeof snap.data.clientId === "string" ? uuidFrom("client", snap.data.clientId) : null;
    const { data: co } = clientId ? await db.from("companies").select("id").eq("id", clientId).maybeSingle() : { data: null };
    return taskRows([snap.data], () => (co ? clientId : null));
  }
  if (entry.kind === "client") {
    if (!snap.data.id) return "The saved client has no id, so it can't be restored safely.";
    const m = mapClient(String(snap.data.id), snap.data);
    const tasks = await taskRows(snap.tasks || [], () => m.company.id as string);
    if (typeof tasks === "string") return tasks;
    return [
      { kind: "client", row: m.company },
      ...m.entitlements.map((row) => ({ kind: "entitlement", row })),
      ...m.contacts.map((row) => ({ kind: "contact", row })),
      ...tasks,
    ];
  }
  if (entry.kind === "standard") {
    const m = mapStandard(String(snap.data.id || snap.data.code || ""), snap.data);
    if (!m) return "The saved standard's number isn't valid.";
    return [{ kind: "standard", row: m.standard }, ...m.templates.map((row) => ({ kind: "template", row }))];
  }
  return "This kind of record can't be restored.";
}
