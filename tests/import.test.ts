// Tracker import: builds the SQL from a FAKE export (shaped exactly like the live tracker's "Export all data"
// file) and runs it in an in-memory Postgres with every migration. No real client data is used here.
// Run: npm test
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
// @ts-ignore: plain JS helper shared with the .mjs tests
import { freshDb } from "./helpers/pg.mjs";
import { buildImportSql, uuidFrom, type TrackerExport } from "../scripts/import-tracker";

const fake: TrackerExport = {
  format: "cgm-tracker-export",
  version: 1,
  exportedAt: "2026-11-05T18:00:00.000Z",
  people: { u_staff1: { name: "Pat Staff" }, u_staff2: { name: "Alex Staff" } },
  collections: {
    standards: [
      { id: "PRC-005", data: { code: "PRC-005", version: "6", title: "Protection System Maintenance", family: "PRC", applies: ["GO", "TO"], url: "", notes: "",
        templates: [{ req: "Table 1-4", title: "Battery inspection", recur: { n: 4, unit: "m", basis: "done" } }, { req: "R1", title: "Event-driven", recur: { n: 0, unit: "m" } }] } },
      { id: "CIP-002", data: { code: "CIP-002", version: "5.1a", title: "BES Cyber System Categorization", family: "CIP", applies: ["GO"], templates: [{ req: "R2", title: "Review", recur: { n: 15, unit: "m" } }] } },
    ],
    clients: [
      { id: "c1", data: { name: "Example Solar LLC", ncr: "NCR00001", region: "WECC", regDate: "2024-01-15", functions: ["GO", "GOP"], entities: { rc: "Example RC" },
        facilities: "Unit 1", contact: "Casey Client", contactEmail: "casey@example.com", digest: true, pmName: "Pat Staff", pmEmail: "pat@example.com", pmDigest: true,
        plantMgrName: "Morgan Plant", plantMgrEmail: "not-an-email", plantMgrDigest: true, sharepoint: "https://example.sharepoint.com/sites/x", notes: "O'Brien's \"site\" $$ notes" } },
      { id: "c2", data: { name: "Example Wind", region: "Atlantis", functions: ["GO"], workspace: true } },
      { id: "cs", data: { name: "Sample Co", sample: true } },
    ],
    tasks: [
      { id: "t1", data: { title: "Battery inspection", clientId: "c1", standard: "PRC-005", requirement: "Table 1-4", dueDate: "2026-07-01", status: "done",
        completedAt: "2026-06-20", recur: { n: 4, unit: "m", basis: "done" }, remindDays: [30, 7, 5], evidence: "https://example.sharepoint.com/e1", nextId: "t2", createdAt: "2026-01-02",
        assignee: "Casey", assigneeEmail: "casey@example.com", outlook: { date: "2026-06-01", count: 3, due: "2026-07-01" } } },
      { id: "t2", data: { title: "Battery inspection", clientId: "c1", standard: "PRC-005", requirement: "Table 1-4", dueDate: "2026-10-20", status: "open",
        recur: { n: 4, unit: "m", basis: "done" }, prevId: "t1" } },
      { id: "t3", data: { title: "Uses a standard missing from the library", clientId: "c2", standard: "VAR-002", dueDate: "", status: "inprogress" } },
      { id: "t4", data: { title: "Client was deleted", clientId: "gone", standard: "not a code", status: "weird", completedAt: "2099-01-01" } },
    ],
    teamTasks: [
      { id: "tt1", data: { title: "Update proposal", owner: "u_staff1", collaborators: ["u_staff2", "u_ghost"], clientId: "c1", estHours: "2.5", status: "inprogress",
        links: [{ label: "Folder", url: "https://example.sharepoint.com/f" }, { label: "bad", url: "http://insecure" }], createdBy: "u_staff1", ownerEmail: "pat@example.com" } },
      { id: "tt2", data: { title: "Internal", estHours: "", status: "done", actualDate: "2026-10-01" } },
    ],
    activity: [
      { id: "2026-10-01", data: { day: "2026-10-01", entries: {
        e1: { ts: "2026-10-01T15:00:00Z", by: "u_staff1", action: "completed", kind: "task", target: "t1", label: "PRC-005 Table 1-4 · Battery inspection", client: "c1", changes: [{ f: "Status", from: "Open", to: "Complete" }] },
        e2: { ts: "2026-10-01T16:00:00Z", by: "u_staff3", action: "deleted", kind: "client", target: "old", label: "Old client", client: "old", hasSnap: true } } } },
    ],
    activitySnapshots: [{ id: "e2", data: { day: "2026-10-01", snap: { data: { name: "Old client" }, tasks: [] } } }],
  },
};

let db: PGlite;
let report: ReturnType<typeof buildImportSql>["report"];
let sql: string;

before(async () => {
  db = await freshDb();
  ({ sql, report } = buildImportSql(fake, "2026-11-05"));
  await db.exec(sql);
});

const one = async (q: string) => (await db.query<any>(q)).rows[0];
const n = async (q: string) => Number((await one(q)).count);

test("every record arrives: clients, tasks, team tasks, history, snapshots", async () => {
  assert.equal(await n("select count(*) from companies where legacy_id in ('c1','c2','cs')"), 3);
  assert.equal(await n("select count(*) from tasks where legacy_id is not null"), 4);
  assert.equal(await n("select count(*) from team_tasks where legacy_id is not null"), 2);
  assert.equal(await n("select count(*) from activity_log where source = 'legacy'"), 2);
  assert.equal(await n("select count(*) from legacy_snapshots"), 1);
  assert.equal(await n("select count(*) from obligation_templates"), 3);
  assert.deepEqual(report.counts.tasks, { in: 4, out: 4 });
});

test("the import itself writes no activity noise and spawns no extra occurrences", async () => {
  assert.equal(await n("select count(*) from activity_log where source = 'app'"), 0);
  assert.equal(await n(`select count(*) from tasks where company_id = '${uuidFrom("client", "c1")}'`), 2);
});

test("fields map correctly, including tricky text and recurrence chains", async () => {
  const c = await one("select * from companies where legacy_id = 'c1'");
  assert.equal(c.notes, `O'Brien's "site" $$ notes`);
  assert.equal(c.region, "WECC");
  assert.equal(c.sharepoint_url, "https://example.sharepoint.com/sites/x");
  assert.deepEqual(c.functions, ["GO", "GOP"]);
  const t1 = await one("select * from tasks where legacy_id = 't1'");
  const t2 = await one("select * from tasks where legacy_id = 't2'");
  assert.equal(t1.next_id, t2.id);
  assert.equal(t2.prev_id, t1.id);
  assert.equal(t1.status, "done");
  assert.equal(t1.recur_basis, "done");
  assert.deepEqual(t1.remind_days, [30, 7], "invalid reminder offsets dropped");
  assert.equal(t1.assignee_email, "casey@example.com");
  assert.equal(t1.outlook.count, 3);
  assert.equal(t1.legacy.remindDays.length, 3, "original document kept in full");
});

test("nothing is dropped: problems are kept in legacy and reported", async () => {
  const t4 = await one("select t.*, c.name as company from tasks t join companies c on c.id = t.company_id where t.legacy_id = 't4'");
  assert.equal(t4.company, "Unassigned (imported)");
  assert.equal(t4.standard_code, null);
  assert.equal(t4.status, "open");
  assert.equal(t4.completed_at, null);
  assert.equal(t4.legacy.completedAt, "2099-01-01");
  assert.equal((await one("select version from library_standards where code = 'VAR-002'")).version, "?");
  assert.ok(report.warnings.some((w) => w.includes("VAR-002")));
  assert.ok(report.warnings.some((w) => w.includes("Atlantis")));
  assert.ok(report.warnings.some((w) => w.includes("not-an-email")));
});

test("clients become Tracker clients; sample clients don't; the add-on flag carries over", async () => {
  const ents = (await db.query<any>("select c.legacy_id, e.product from entitlements e join companies c on c.id = e.company_id order by 1, 2")).rows;
  assert.deepEqual(ents.map((e) => `${e.legacy_id}:${e.product}`), ["c1:tracker", "c2:client_tasks", "c2:tracker"]);
  const kinds = (await db.query<any>("select kind, email, digest from contacts where company_id = (select id from companies where legacy_id = 'c1') order by kind")).rows;
  assert.deepEqual(kinds.map((k) => k.kind), ["compliance", "plant_manager", "pm"]);
  assert.equal(kinds.find((k) => k.kind === "plant_manager").email, null);
});

test("CGM people are kept by pilot id and can be linked to real logins later", async () => {
  assert.equal(await n("select count(*) from legacy_people"), 4); // 2 named + ghost collaborator + unknown activity author
  await db.exec(`insert into auth.users values ('10000000-0000-0000-0000-000000000001', 'pat@cgm.example')`);
  await db.exec(`select link_legacy_person('u_staff1', '10000000-0000-0000-0000-000000000001')`);
  const tt = await one("select owner_id from team_tasks where legacy_id = 'tt1'");
  assert.equal(tt.owner_id, "10000000-0000-0000-0000-000000000001");
});

test("the import refuses to run twice", async () => {
  await assert.rejects(db.exec(sql), /already been imported/);
  await db.exec("rollback");
  assert.equal(await n("select count(*) from tasks where legacy_id is not null"), 4, "nothing duplicated");
});

test("after import, normal rules apply: completing an imported recurring task spawns the next one once", async () => {
  await db.exec(`update tasks set status = 'done', completed_at = '2026-11-01' where legacy_id = 't2'`);
  const next = await one(`select due_date::text as d from tasks where prev_id = (select id from tasks where legacy_id = 't2')`);
  assert.equal(next.d, "2027-03-01", "4 months from completion");
});
