/* Move the pilot Compliance Tracker's data into the app, with no re-entry.

   1. In the live tracker (claude.ai), click "Export all data" (Editors only). Save the JSON file.
   2. Put it in data/private/ (git-ignored). Never commit it: it holds client data.
   3. npm run import:tracker -- data/private/cgm-tracker-full-export-YYYY-MM-DD.json
      -> writes data/private/import-tracker.sql and prints a reconciliation report.
   4. Dry run against a local Supabase first, then production:
      psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f data/private/import-tracker.sql
   The SQL is one transaction: all of it lands, or none of it does. It refuses to run twice.
   See docs/IMPORT.md. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type Doc = { id: string; data: Record<string, any> };
export type TrackerExport = {
  format: string;
  version: number;
  exportedAt: string;
  people?: Record<string, { name: string }>;
  collections: Record<string, Doc[]>;
};
type Row = Record<string, unknown>;

import { CODE_RE, date, mapClient, mapClientTask, mapStandard, mapTask, mapTeamTask, standardOf, text, uuidFrom } from "../lib/legacy-map";

// The per-record mapping lives in lib/legacy-map.ts, shared with Restore of records deleted before the move.
export { uuidFrom };

export function buildImportSql(exp: TrackerExport, today = new Date().toISOString().slice(0, 10)) {
  if (exp.format !== "cgm-tracker-export") throw new Error("Not a tracker export file (format should be cgm-tracker-export).");
  const C = exp.collections || {};
  const warnings: string[] = [];
  const counts: Record<string, { in: number; out: number }> = {};
  const count = (k: string, i: number, o: number) => (counts[k] = { in: i, out: o });

  // ---- standards library ----
  const standards: Row[] = [];
  const templates: Row[] = [];
  const codes = new Set<string>();
  for (const d of C.standards || []) {
    const m = mapStandard(d.id, d.data);
    if (!m) { warnings.push(`Standard "${String(d.data.code || d.id).trim().toUpperCase()}" skipped: not a valid standard number.`); continue; }
    codes.add(m.standard.code as string);
    standards.push(m.standard);
    templates.push(...m.templates);
  }
  count("standards", (C.standards || []).length, standards.length);

  // ---- clients -> companies, contacts, entitlements ----
  const companies: Row[] = [];
  const contacts: Row[] = [];
  const entitlements: Row[] = [];
  const companyId = new Map<string, string>();
  for (const d of C.clients || []) {
    const m = mapClient(d.id, d.data, (w) => warnings.push(w));
    companyId.set(d.id, m.company.id as string);
    companies.push(m.company);
    contacts.push(...m.contacts);
    entitlements.push(...m.entitlements);
  }
  count("clients", (C.clients || []).length, companies.length);

  // Tasks whose client no longer exists go to a holding company so nothing is dropped.
  let orphanCompany: string | null = null;
  const clientFor = (legacyClient: unknown, what: string) => {
    const hit = typeof legacyClient === "string" ? companyId.get(legacyClient) : undefined;
    if (hit) return hit;
    if (!orphanCompany) {
      orphanCompany = uuidFrom("client", "__unassigned__");
      companies.push({ id: orphanCompany, name: "Unassigned (imported)", legacy_id: "__unassigned__", functions: [], entities: {}, sample: false, legacy: {} });
    }
    warnings.push(`${what}: client "${legacyClient ?? ""}" not found; put under "Unassigned (imported)".`);
    return orphanCompany;
  };

  // ---- NERC tasks ----
  const tasks: Row[] = [];
  const taskLinks: Row[] = [];
  const taskId = new Map<string, string>();
  for (const d of C.tasks || []) taskId.set(d.id, uuidFrom("task", d.id));
  for (const d of C.tasks || []) {
    const t = d.data;
    let std = standardOf(t);
    if (std && !codes.has(std)) {
      if (CODE_RE.test(std)) {
        codes.add(std);
        standards.push({ code: std, version: "?", title: `${std} (added during import)`, family: std.split("-")[0], applies: [], notes: "Referenced by imported tasks but missing from the library. Confirm version and title.", custom: true });
        warnings.push(`Standard ${std} is used by tasks but wasn't in the library; added as a placeholder to confirm.`);
      } else {
        warnings.push(`Task ${d.id}: standard "${t.standard}" isn't a valid number; left blank (kept in legacy).`);
        std = null;
      }
    }
    const row = mapTask(d.id, t, { companyId: clientFor(t.clientId, `Task ${d.id}`), standard: std, today, exportedAt: exp.exportedAt, warn: (w) => warnings.push(w) });
    tasks.push(row);
    const id = row.id as string;
    const link = (v: unknown) => (typeof v === "string" && taskId.has(v) ? taskId.get(v) : null);
    const prev = link(t.prevId), next = link(t.nextId), copied = link(t.copiedFrom);
    if (prev || next || copied) taskLinks.push({ id, prev_id: prev, next_id: next, copied_from: copied });
  }
  count("tasks", (C.tasks || []).length, tasks.length);

  // ---- team tasks ----
  const team: Row[] = [];
  for (const d of C.teamTasks || []) {
    const t = d.data;
    team.push(mapTeamTask(d.id, t, { companyId: t.clientId ? clientFor(t.clientId, `Team task ${d.id}`) : null, exportedAt: exp.exportedAt }));
  }
  count("teamTasks", (C.teamTasks || []).length, team.length);

  // ---- client tasks (sandbox add-on; empty in the live tracker today) ----
  const ctasks: Row[] = [];
  for (const d of C.clientTasks || []) {
    const t = d.data;
    ctasks.push(mapClientTask(d.id, t, { companyId: clientFor(t.clientId, `Client task ${d.id}`) }));
  }
  count("clientTasks", (C.clientTasks || []).length, ctasks.length);

  // ---- task plans (sandbox) ----
  const plans: Row[] = [];
  for (const d of C.taskPlans || []) {
    const p = d.data;
    plans.push({
      id: d.id, title: String(p.title || d.id), standard_code: text(p.standard), body: String(p.body || ""),
      matches: Array.isArray(p.matches) ? p.matches.map(String) : [], plan_group: text(p.group), pos: Number.isFinite(p.order) ? p.order : null,
      source: text(p.source), legacy: p,
    });
  }
  count("taskPlans", (C.taskPlans || []).length, plans.length);

  // ---- people ----
  const people: Row[] = Object.entries(exp.people || {}).map(([legacy_id, p]) => ({ legacy_id, name: p?.name || "" }));
  const known = new Set(people.map((p) => p.legacy_id));
  const addPerson = (id: unknown) => {
    if (typeof id === "string" && id && !known.has(id)) { known.add(id); people.push({ legacy_id: id, name: "" }); }
  };
  team.forEach((t) => { addPerson(t.owner_legacy); addPerson(t.created_by_legacy); (t.collaborators_legacy as string[]).forEach(addPerson); });

  // ---- activity history and deleted-record snapshots ----
  const activity: Row[] = [];
  let entriesIn = 0;
  const kindMap: Record<string, string> = { task: "task", team: "team", client: "client", standard: "standard", ctask: "ctask", plan: "plan" };
  for (const d of C.activity || []) {
    for (const [eid, e] of Object.entries<any>(d.data.entries || {})) {
      entriesIn++;
      addPerson(e.by);
      const target = e.target && taskId.has(e.target) && e.kind === "task" ? taskId.get(e.target) : e.target;
      activity.push({
        at: e.ts || `${d.data.day || d.id}T12:00:00Z`, action: String(e.action || "updated"), kind: kindMap[e.kind] || String(e.kind || "other"),
        target_id: String(target || ""), company_id: typeof e.client === "string" ? companyId.get(e.client) ?? null : null,
        label: text(e.label), source: "legacy", legacy: { ...e, entryId: eid },
      });
    }
  }
  count("activity entries", entriesIn, activity.length);
  const snaps: Row[] = (C.activitySnapshots || []).map((d) => ({ entry_id: d.id, day: date(d.data.day), snap: d.data.snap ?? d.data }));
  count("activitySnapshots", (C.activitySnapshots || []).length, snaps.length);

  for (const k of Object.keys(C)) {
    if (!["standards", "clients", "tasks", "teamTasks", "clientTasks", "taskPlans", "activity", "activitySnapshots"].includes(k) && (C[k] || []).length) {
      warnings.push(`Collection "${k}" (${C[k].length} documents) has no destination yet and was not imported.`);
    }
  }

  // ---- SQL ----
  const TAG = "$cgmimport$";
  const ins = (table: string, rows: Row[], conflict = "") => {
    if (!rows.length) return "";
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const json = JSON.stringify(rows);
    if (json.includes(TAG)) throw new Error("Export contains the SQL quoting tag; cannot build a safe import.");
    return `insert into public.${table} (${cols.join(", ")})\nselect ${cols.join(", ")} from jsonb_populate_recordset(null::public.${table}, ${TAG}${json}${TAG}::jsonb)${conflict};\n`;
  };
  const sql = [
    `-- CGM tracker import, built ${new Date().toISOString()} from an export taken ${exp.exportedAt}.`,
    `-- One transaction. Contains client data: do not commit or share this file.`,
    `begin;`,
    `set local app.importing = 'on';`,
    `do $$ begin if exists (select 1 from public.companies where legacy_id is not null) then raise exception 'Tracker data has already been imported into this database. Restore a backup or clear imported rows before importing again.'; end if; end $$;`,
    ins("library_standards", standards, " on conflict (code) do update set version = excluded.version, title = excluded.title, family = excluded.family, applies = excluded.applies, url = excluded.url, notes = excluded.notes, custom = excluded.custom"),
    standards.length ? `delete from public.obligation_templates where standard_code in (select code from jsonb_to_recordset(${TAG}${JSON.stringify(standards.map((s) => ({ code: s.code })))}${TAG}::jsonb) as x(code text));\n` : "",
    ins("obligation_templates", templates),
    ins("companies", companies),
    ins("contacts", contacts),
    ins("entitlements", entitlements, " on conflict (company_id, product) do nothing"),
    ins("task_plans", plans, " on conflict (id) do nothing"),
    ins("tasks", tasks),
    taskLinks.length
      ? `update public.tasks t set prev_id = x.prev_id, next_id = x.next_id, copied_from = x.copied_from from jsonb_to_recordset(${TAG}${JSON.stringify(taskLinks)}${TAG}::jsonb) as x(id uuid, prev_id uuid, next_id uuid, copied_from uuid) where t.id = x.id;\n`
      : "",
    ins("team_tasks", team),
    ins("client_tasks", ctasks),
    ins("legacy_people", people, " on conflict (legacy_id) do update set name = excluded.name"),
    ins("activity_log", activity),
    ins("legacy_snapshots", snaps, " on conflict (entry_id) do nothing"),
    `-- Reconciliation: these must match the report printed by the import script.`,
    `select 'companies' as what, count(*) from public.companies where legacy_id is not null union all select 'tasks', count(*) from public.tasks where legacy_id is not null union all select 'team_tasks', count(*) from public.team_tasks where legacy_id is not null union all select 'activity (legacy)', count(*) from public.activity_log where source = 'legacy';`,
    `commit;`,
  ].join("\n");

  return { sql, report: { exportedAt: exp.exportedAt, counts, warnings, rows: { companies: companies.length, contacts: contacts.length, entitlements: entitlements.length, tasks: tasks.length, team_tasks: team.length, client_tasks: ctasks.length, task_plans: plans.length, library_standards: standards.length, obligation_templates: templates.length, legacy_people: people.length, activity_log: activity.length, legacy_snapshots: snaps.length } } };
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run import:tracker -- data/private/<export>.json [out.sql]");
    process.exit(1);
  }
  const out = process.argv[3] || "data/private/import-tracker.sql";
  const { sql, report } = buildImportSql(JSON.parse(readFileSync(file, "utf8")));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, sql);
  writeFileSync(out.replace(/\.sql$/, "") + "-report.json", JSON.stringify(report, null, 2));
  console.log(`Export taken ${report.exportedAt}`);
  for (const [k, v] of Object.entries(report.counts)) console.log(`  ${k.padEnd(20)} ${String(v.in).padStart(6)} in  ${String(v.out).padStart(6)} out`);
  console.log(`Rows to insert: ${JSON.stringify(report.rows)}`);
  if (report.warnings.length) {
    console.log(`\n${report.warnings.length} warning(s):`);
    report.warnings.forEach((w) => console.log(`  - ${w}`));
  }
  console.log(`\nWrote ${out}. Run it with: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f ${out}`);
}

if (process.argv[1]?.endsWith("import-tracker.ts")) main();
