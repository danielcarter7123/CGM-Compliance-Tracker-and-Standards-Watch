import "server-only";
import type { Viewer } from "./auth";
import type { LogEntry } from "./activity";
import type { createClient } from "./supabase/server";

type Db = ReturnType<typeof createClient>;
export type ActivityFilters = { range: string; who: string; kind: string; client: string; q: string; n: number };

export function activityFilters(p: Record<string, string | undefined>): ActivityFilters {
  const n = Math.min(Math.max(Number(p.n) || 200, 200), 5000);
  return { range: p.range || "30", who: p.who || "", kind: p.kind || "", client: p.client || "", q: (p.q || "").trim(), n };
}

const COLS = "id, at, actor_id, action, kind, target_id, company_id, label, old_row, new_row, source, legacy, ref_id";
// Characters that would break a PostgREST filter expression.
const safe = (s: string) => s.replace(/[,()*"'\\:]/g, " ").trim().slice(0, 100);

/** Reads the log as the signed-in person (row level security: clients get their own company's task, client-task and
 *  evidence history), with names for people and clients, and which entries were later restored or reverted. */
export async function loadActivity(db: Db, v: Viewer, f: ActivityFilters) {
  let query = db.from("activity_log").select(COLS).order("at", { ascending: false }).order("id", { ascending: false }).limit(f.n + 1);
  if (f.range !== "all") query = query.gte("at", new Date(Date.now() - Number(f.range || 30) * 86400e3).toISOString());
  if (f.kind) query = query.eq("kind", f.kind);
  if (f.client && v.isStaff) query = query.eq("company_id", f.client);

  // People: CGM staff (and everyone else for staff) by profile; pilot authors through legacy_people (staff only).
  const [{ data: profs }, { data: legacyPeople }, { data: cos }] = await Promise.all([
    v.isStaff ? db.from("profiles").select("id, full_name, email, staff_role") : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null; staff_role: string | null }[] }),
    v.isStaff ? db.from("legacy_people").select("legacy_id, name, profile_id") : Promise.resolve({ data: [] as { legacy_id: string; name: string; profile_id: string | null }[] }),
    db.from("companies").select("id, name"),
  ]);
  const legacy = (legacyPeople || []) as { legacy_id: string; name: string; profile_id: string | null }[];
  if (f.who) {
    if (f.who.startsWith("l:")) query = query.eq("legacy->>by", safe(f.who.slice(2)));
    else {
      const linked = legacy.filter((l) => l.profile_id === f.who).map((l) => safe(l.legacy_id)).filter(Boolean);
      query = query.or([`actor_id.eq.${safe(f.who)}`, ...linked.map((l) => `legacy->>by.eq.${l}`)].join(","));
    }
  }
  if (f.q) {
    const q = safe(f.q);
    if (q) query = query.or(`label.ilike.*${q}*,legacy->>note.ilike.*${q}*,legacy->>clientName.ilike.*${q}*`);
  }
  const { data, error } = await query;
  const all = (data || []) as LogEntry[];
  const more = all.length > f.n;
  const rows = all.slice(0, f.n);

  // Names.
  const names = new Map<string, string>();
  for (const p of profs || []) names.set(p.id, p.full_name || p.email || "A team member");
  if (!v.isStaff) {
    const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: ns } = await db.rpc("people_names", { ids });
      for (const n of (ns || []) as { id: string; name: string }[]) names.set(n.id, n.name);
    }
  }
  const legacyName = new Map(legacy.map((l) => [l.legacy_id, l.profile_id ? names.get(l.profile_id) || l.name : l.name]));
  const personName = (id: string) => (id === v.userId ? "You" : names.get(id) || "Someone");
  const who = (e: LogEntry) =>
    e.source === "legacy"
      ? (e.legacy?.by && legacyName.get(e.legacy.by)) || (e.legacy?.by ? "Someone" : "System")
      : e.actor_id ? personName(e.actor_id) : "System";
  const companies = (cos || []) as { id: string; name: string }[];
  const clientName = (id: string) => companies.find((c) => c.id === id)?.name || "(removed client)";
  const client = (e: LogEntry) => (e.company_id ? clientName(e.company_id) : e.legacy?.clientName || "");

  // Later restores and reverts of these entries.
  const ids = rows.map((r) => r.id);
  const followUps = new Map<number, { action: string; at: string; by: string }>();
  if (ids.length) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data: refs } = await db.from("activity_log").select("ref_id, action, at, actor_id").in("ref_id", ids.slice(i, i + 200));
      for (const r of (refs || []) as { ref_id: number; action: string; at: string; actor_id: string | null }[]) {
        if (!followUps.has(r.ref_id)) followUps.set(r.ref_id, { action: r.action, at: r.at, by: r.actor_id ? personName(r.actor_id) : "System" });
      }
    }
  }

  const people: [string, string][] = v.isStaff
    ? [
        ...((profs || []).filter((p) => p.staff_role).map((p) => [p.id, p.full_name || p.email || "A team member"]) as [string, string][]),
        ...(legacy.filter((l) => !l.profile_id && l.name).map((l) => [`l:${l.legacy_id}`, `${l.name} (from the pilot)`]) as [string, string][]),
      ].sort((a, b) => a[1].localeCompare(b[1]))
    : [];

  return { rows, more, error, who, client, personName, clientName, followUps, people, companies };
}
