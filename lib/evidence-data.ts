import "server-only";
import type { Evidence } from "./evidence";
import type { createClient } from "./supabase/server";
import type { Task } from "./tasks";

type Db = ReturnType<typeof createClient>;
export const EVIDENCE_COLS =
  "id, company_id, task_id, client_task_id, kind, title, url, storage_path, file_name, size_bytes, mime_type, sha256, added_by, created_at, removed_at, removed_by";

/** Marks tasks that have at least one evidence item not removed ("report posted", with the pilot's link rule). */
export async function markEvidence<T extends Task>(db: Db, tasks: T[]): Promise<T[]> {
  const ids = tasks.filter((t) => t.status === "review" || t.status === "done").map((t) => t.id);
  if (!ids.length) return tasks;
  const has = new Set<string>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await db.from("evidence").select("task_id").in("task_id", ids.slice(i, i + 300)).is("removed_at", null);
    for (const r of data || []) has.add(r.task_id as string);
  }
  return tasks.map((t) => (has.has(t.id) ? { ...t, has_evidence: true } : t));
}

/** Evidence for one task or client task, with display names for who added and removed it. */
export async function evidenceFor(db: Db, target: { task?: string; ctask?: string }) {
  const q = db.from("evidence").select(EVIDENCE_COLS).order("created_at");
  const { data } = await (target.task ? q.eq("task_id", target.task) : q.eq("client_task_id", target.ctask!));
  const items = (data || []) as Evidence[];
  const ids = [...new Set(items.flatMap((e) => [e.added_by, e.removed_by]).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: ns } = await db.rpc("people_names", { ids });
    for (const n of (ns || []) as { id: string; name: string }[]) names.set(n.id, n.name);
  }
  return { items, names };
}
