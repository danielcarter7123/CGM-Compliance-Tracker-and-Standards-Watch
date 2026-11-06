// Access-rule tests. Runs every migration in supabase/migrations in an in-memory Postgres (PGlite)
// with a minimal stand-in for Supabase's auth schema, then checks what each kind of user can do.
// Run: npm test
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./helpers/pg.mjs";

// People
const ADMIN = "10000000-0000-0000-0000-000000000001";   // CGM admin (Dan)
const PM = "10000000-0000-0000-0000-000000000002";      // CGM project manager
const STAFF = "10000000-0000-0000-0000-000000000003";   // CGM staff
const W_USER = "20000000-0000-0000-0000-000000000001";  // client with Standards Watch only
const T_USER = "30000000-0000-0000-0000-000000000001";  // client A, Tracker (+ Client Tasks), member
const T_ADMIN = "30000000-0000-0000-0000-000000000002"; // client A, company admin
const B_USER = "40000000-0000-0000-0000-000000000001";  // client B, Tracker only
const NOPLAN = "50000000-0000-0000-0000-000000000001";  // signed in, nothing bought
// Companies
const W_CO = "a0000000-0000-0000-0000-00000000000a";
const A_CO = "a0000000-0000-0000-0000-00000000000b";
const B_CO = "a0000000-0000-0000-0000-00000000000c";

let db;
let taskA, taskB, ctaskA;

before(async () => {
  db = await freshDb();
  await db.exec(`
    insert into auth.users values
      ('${ADMIN}','dan@x.com'),('${PM}','pm@x.com'),('${STAFF}','staff@x.com'),
      ('${W_USER}','w@w.com'),('${T_USER}','t@a.com'),('${T_ADMIN}','admin@a.com'),('${B_USER}','b@b.com'),('${NOPLAN}','n@n.com');
    update profiles set staff_role = 'admin' where id = '${ADMIN}';
    update profiles set staff_role = 'pm' where id = '${PM}';
    update profiles set staff_role = 'staff' where id = '${STAFF}';
    insert into companies(id, name) values ('${W_CO}','Watch Only Co'),('${A_CO}','Client A'),('${B_CO}','Client B');
    update profiles set company_id = '${W_CO}' where id = '${W_USER}';
    update profiles set company_id = '${A_CO}' where id in ('${T_USER}','${T_ADMIN}');
    update profiles set company_role = 'admin' where id = '${T_ADMIN}';
    update profiles set company_id = '${B_CO}' where id = '${B_USER}';
    insert into entitlements(company_id, product, source) values
      ('${W_CO}','watch','stripe'),('${A_CO}','tracker','contract'),('${A_CO}','client_tasks','contract'),('${B_CO}','tracker','contract');
    insert into standards(id, std, title, topic) values ('eop-004-5','EOP-004-5','Event Reporting','ops');
    insert into drafts(id, section, op, key) values ('d1','items','upsert','eop-004-5');
    insert into library_standards(code, version, title, family, applies) values ('PRC-005','6','Protection System Maintenance','PRC','{GO,TO}');
    insert into team_tasks(title) values ('Internal: update proposal template');
    insert into task_plans(id, title) values ('plan-1','Battery inspection steps');
  `);
  taskA = (await db.query(`insert into tasks(company_id, title, standard_code, due_date, recur_n, recur_unit, recur_basis)
    values ('${A_CO}','Battery inspection','PRC-005','2026-11-30',4,'m','due') returning id`)).rows[0].id;
  taskB = (await db.query(`insert into tasks(company_id, title, due_date) values ('${B_CO}','B task','2026-12-15') returning id`)).rows[0].id;
  ctaskA = (await db.query(`insert into client_tasks(company_id, title, due_date) values ('${A_CO}','SPCC inspection','2026-12-01') returning id`)).rows[0].id;
});

async function as(uid, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return (await db.query(sql)).rows;
  } finally {
    await db.exec("reset role");
  }
}
async function fails(uid, sql) {
  try {
    await as(uid, sql);
    return false;
  } catch (e) {
    if (process.env.SHOW_ERRORS) console.log("  refused:", e.message);
    return true;
  }
}
const count = async (uid, sql) => Number((await as(uid, sql))[0].count);

// ---------- Standards Watch ----------
test("Watch content: Watch and Tracker clients and staff read it; no plan reads nothing", async () => {
  for (const u of [ADMIN, STAFF, W_USER, T_USER, B_USER]) assert.equal(await count(u, "select count(*) from standards"), 1, u);
  assert.equal(await count(NOPLAN, "select count(*) from standards"), 0);
});

test("Watch drafts: CGM admins only", async () => {
  assert.equal(await count(ADMIN, "select count(*) from drafts"), 1);
  for (const u of [PM, STAFF, W_USER, T_USER]) assert.equal(await count(u, "select count(*) from drafts"), 0, u);
});

test("only CGM admins publish Watch content", async () => {
  assert.equal((await as(W_USER, "update standards set title = 'x' returning id")).length, 0);
  assert.equal((await as(STAFF, "update standards set title = 'x' returning id")).length, 0);
  assert.equal((await as(ADMIN, "update standards set title = 'Event Reporting' returning id")).length, 1);
});

test("a canceled Watch subscription loses access", async () => {
  await db.exec(`update entitlements set status = 'canceled' where company_id = '${W_CO}'`);
  assert.equal(await count(W_USER, "select count(*) from standards"), 0);
  await db.exec(`update entitlements set status = 'active' where company_id = '${W_CO}'`);
});

// ---------- People ----------
test("nobody promotes themselves", async () => {
  const [row] = await as(T_USER, `update profiles set staff_role = 'admin', role = 'editor', company_role = 'admin', functions = '{TO}' where id = '${T_USER}' returning staff_role, role, company_role, functions`);
  assert.equal(row.staff_role, null);
  assert.equal(row.role, "subscriber");
  assert.equal(row.company_role, "member");
  assert.deepEqual(row.functions, ["TO"]);
});

test("company admins see their colleagues and can change only their company role", async () => {
  assert.equal(await count(T_ADMIN, `select count(*) from profiles where company_id = '${A_CO}'`), 2);
  assert.equal(await count(T_ADMIN, `select count(*) from profiles where id = '${B_USER}'`), 0);
  const [r] = await as(T_ADMIN, `update profiles set company_role = 'admin', staff_role = 'admin', full_name = 'x' where id = '${T_USER}' returning company_role, staff_role, full_name`);
  assert.equal(r.company_role, "admin");
  assert.equal(r.staff_role, null);
  assert.equal(r.full_name, null);
  await db.exec(`update profiles set company_role = 'member' where id = '${T_USER}'`);
  assert.equal(await count(T_USER, `select count(*) from profiles where id = '${T_ADMIN}'`), 0, "members don't see colleagues");
});

test("clients cannot grant themselves products", async () => {
  assert.ok(await fails(T_ADMIN, `insert into entitlements(company_id, product) values ('${A_CO}','watch')`));
  assert.equal((await as(T_ADMIN, `update entitlements set status = 'active' where company_id = '${A_CO}' returning product`)).length, 0);
  assert.equal(await count(T_USER, "select count(*) from entitlements"), 2, "but they can see what they have");
});

// ---------- Tracker: isolation ----------
test("staff see every client's tasks; clients see only their own; Watch-only clients see none", async () => {
  assert.equal(await count(STAFF, "select count(*) from tasks"), 2);
  assert.equal(await count(T_USER, "select count(*) from tasks"), 1);
  assert.equal(await count(T_USER, `select count(*) from tasks where id = '${taskB}'`), 0);
  assert.equal(await count(B_USER, "select count(*) from tasks"), 1);
  assert.equal(await count(W_USER, "select count(*) from tasks"), 0);
  assert.equal(await count(NOPLAN, "select count(*) from tasks"), 0);
});

test("clients cannot see other companies", async () => {
  assert.equal(await count(T_USER, "select count(*) from companies"), 1);
  assert.equal(await count(STAFF, "select count(*) from companies"), 3);
});

test("library is readable by tracker clients, not Watch-only clients; task plans and team tasks are staff only", async () => {
  assert.equal(await count(T_USER, "select count(*) from library_standards"), 1);
  assert.equal(await count(W_USER, "select count(*) from library_standards"), 0);
  assert.equal(await count(T_USER, "select count(*) from task_plans"), 0);
  assert.equal(await count(STAFF, "select count(*) from task_plans"), 1);
  assert.equal(await count(T_USER, "select count(*) from team_tasks"), 0);
  assert.equal(await count(STAFF, "select count(*) from team_tasks"), 1);
});

// ---------- Tracker: task lifecycle ----------
test("clients cannot create, delete or reschedule tasks", async () => {
  assert.ok(await fails(T_USER, `insert into tasks(company_id, title) values ('${A_CO}','x')`));
  assert.equal((await as(T_USER, `delete from tasks where id = '${taskA}' returning id`)).length, 0);
  assert.ok(await fails(T_USER, `update tasks set due_date = '2027-06-30' where id = '${taskA}'`));
  assert.equal((await as(T_USER, `update tasks set title = 'x' where id = '${taskB}' returning id`)).length, 0, "other company: no rows");
});

test("a client marks a task performed with evidence; the next occurrence is created", async () => {
  const [r] = await as(T_USER, `update tasks set status = 'review', evidence = 'https://example.sharepoint.com/a' where id = '${taskA}' returning status, performed_by, completed_at, next_id`);
  assert.equal(r.status, "review");
  assert.equal(r.performed_by, T_USER);
  assert.ok(r.completed_at);
  assert.ok(r.next_id, "next occurrence linked");
  const [n] = (await db.query(`select due_date::text as d, status, prev_id from tasks where id = '${r.next_id}'`)).rows;
  assert.equal(n.d, "2027-03-30", "4 months after the previous due date");
  assert.equal(n.status, "open");
  assert.equal(n.prev_id, taskA);
});

test("clients and CGM staff cannot approve; PMs can", async () => {
  assert.ok(await fails(T_USER, `update tasks set status = 'done' where id = '${taskA}'`));
  assert.ok(await fails(STAFF, `update tasks set status = 'done' where id = '${taskA}'`));
  const [r] = await as(PM, `update tasks set status = 'done' where id = '${taskA}' returning status, reviewed_by, next_id`);
  assert.equal(r.status, "done");
  assert.equal(r.reviewed_by, PM);
  assert.equal(await count(ADMIN, `select count(*) from tasks where prev_id = '${taskA}'`), 1, "no second occurrence");
});

test("recurrence math: completion basis, calendar years, month-end clamping", async () => {
  const [{ a, b, c }] = (await db.query(`select next_due('2026-03-10', 1, 'y')::text as a, next_due('2026-01-31', 1, 'm')::text as b, next_due('2026-11-05', 30, 'd')::text as c`)).rows;
  assert.equal(a, "2027-12-31");
  assert.equal(b, "2026-02-28");
  assert.equal(c, "2026-12-05");
});

// ---------- Client Tasks add-on ----------
test("Client Tasks: clients with the add-on manage their own; others cannot", async () => {
  assert.equal(await count(T_USER, "select count(*) from client_tasks"), 1);
  assert.equal((await as(T_USER, `insert into client_tasks(company_id, title) values ('${A_CO}','Fire extinguisher check') returning id`)).length, 1);
  assert.equal(await count(B_USER, "select count(*) from client_tasks"), 0);
  assert.ok(await fails(B_USER, `insert into client_tasks(company_id, title) values ('${B_CO}','x')`), "B has no add-on");
  assert.ok(await fails(T_USER, `insert into client_tasks(company_id, title) values ('${B_CO}','x')`), "not another company");
});

test("Client Tasks add-on stops working if the Tracker lapses", async () => {
  await db.exec(`update entitlements set status = 'canceled' where company_id = '${A_CO}' and product = 'tracker'`);
  assert.equal(await count(T_USER, "select count(*) from client_tasks"), 0);
  assert.equal(await count(T_USER, "select count(*) from tasks"), 0);
  assert.equal(await count(T_USER, "select count(*) from standards"), 0, "Tracker included Watch; both end");
  await db.exec(`update entitlements set status = 'active' where company_id = '${A_CO}' and product = 'tracker'`);
});

// ---------- Messages ----------
test("client channels: the client's users and staff; DMs: members only; team channels: staff only", async () => {
  const [{ id: chA }] = (await db.query(`insert into chats(type, company_id) values ('client','${A_CO}') returning id`)).rows;
  const [{ id: dm }] = (await db.query(`insert into chats(type, members) values ('dm','{${ADMIN},${PM}}') returning id`)).rows;
  const [{ id: team }] = (await db.query(`insert into chats(type, name) values ('channel','General') returning id`)).rows;
  assert.equal((await as(T_USER, `insert into chat_messages(chat_id, body) values ('${chA}','Report posted') returning id`)).length, 1);
  assert.equal(await count(STAFF, `select count(*) from chat_messages where chat_id = '${chA}'`), 1);
  assert.equal(await count(B_USER, `select count(*) from chat_messages where chat_id = '${chA}'`), 0);
  assert.ok(await fails(B_USER, `insert into chat_messages(chat_id, body) values ('${chA}','x')`));
  assert.equal(await count(STAFF, `select count(*) from chats where id = '${dm}'`), 0, "staff outside the DM");
  assert.equal(await count(PM, `select count(*) from chats where id = '${dm}'`), 1);
  assert.equal(await count(T_USER, `select count(*) from chats where id = '${team}'`), 0);
  assert.ok(await fails(T_USER, `insert into chat_messages(chat_id, body, author_id) values ('${chA}','spoof','${PM}')`), "can't post as someone else");
});

// ---------- Audit log ----------
test("audit log records task events, is append-only, and clients see only their own company's task history", async () => {
  const actions = (await db.query(`select action from activity_log where target_id = '${taskA}' order by id`)).rows.map((r) => r.action);
  assert.deepEqual(actions, ["created", "performed", "approved"]);
  assert.ok(await fails(ADMIN, "insert into activity_log(action, kind, target_id) values ('x','task','y')"));
  assert.equal((await as(ADMIN, "delete from activity_log returning id")).length, 0);
  assert.equal(await count(T_USER, `select count(*) from activity_log where company_id = '${B_CO}'`), 0);
  assert.ok((await count(T_USER, `select count(*) from activity_log where company_id = '${A_CO}'`)) >= 3);
  assert.equal(await count(T_USER, "select count(*) from activity_log where kind in ('team','client','entitlement')"), 0);
});

// ---------- Evidence: links, SharePoint items, uploaded files ----------
test("clients add evidence to their own tasks only; other clients can't see it", async () => {
  const [{ id: e1 }] = await as(T_USER, `insert into evidence(company_id, task_id, kind, url, title) values ('${A_CO}','${taskA}','link','https://example.sharepoint.com/a','Report') returning id`);
  assert.ok(e1);
  await as(T_USER, `insert into evidence(company_id, task_id, kind, url, sp_drive_id, sp_item_id) values ('${A_CO}','${taskA}','sharepoint','https://example.sharepoint.com/b','drive1','item1')`);
  await as(T_USER, `insert into evidence(company_id, task_id, kind, storage_path, file_name, size_bytes) values ('${A_CO}','${taskA}','file','${A_CO}/${taskA}/f1-report.pdf','report.pdf',1024)`);
  assert.equal(await count(T_USER, "select count(*) from evidence"), 3);
  assert.equal(await count(STAFF, "select count(*) from evidence"), 3);
  assert.equal(await count(B_USER, "select count(*) from evidence"), 0);
  assert.equal(await count(W_USER, "select count(*) from evidence"), 0);
  assert.ok(await fails(T_USER, `insert into evidence(company_id, task_id, kind, url) values ('${A_CO}','${taskB}','link','https://x.test')`), "task from another client");
  assert.ok(await fails(B_USER, `insert into evidence(company_id, task_id, kind, url) values ('${A_CO}','${taskA}','link','https://x.test')`), "posting into another client");
  assert.ok(await fails(T_USER, `insert into evidence(company_id, task_id, kind, storage_path) values ('${A_CO}','${taskA}','file','${B_CO}/x.pdf')`), "file path outside own folder");
  assert.ok(await fails(T_USER, `insert into evidence(company_id, task_id, kind, url) values ('${A_CO}','${taskA}','sharepoint','https://x.test')`), "SharePoint item needs its ids");
  assert.ok(await fails(T_USER, `insert into evidence(company_id, task_id, kind, url, added_by) values ('${A_CO}','${taskA}','link','https://x.test','${PM}')`), "can't add as someone else");
});

test("evidence can't be edited, only removed (soft) by whoever added it or by staff", async () => {
  const [{ id }] = (await db.query(`select id from evidence where kind = 'link' limit 1`)).rows;
  assert.ok(await fails(T_USER, `update evidence set url = 'https://changed.test' where id = '${id}'`));
  assert.equal((await as(T_ADMIN, `update evidence set removed_at = now() where id = '${id}' returning id`)).length, 0, "a colleague can't remove it");
  const [r] = await as(T_USER, `update evidence set removed_at = now() where id = '${id}' returning removed_by`);
  assert.equal(r.removed_by, T_USER);
  assert.equal((await as(T_USER, `delete from evidence where id = '${id}' returning id`)).length, 0, "never hard-deleted by clients");
});

test("uploaded files: private bucket, each client only inside its own folder", async () => {
  assert.equal((await as(T_USER, `insert into storage.objects(bucket_id, name) values ('evidence','${A_CO}/${taskA}/f2.pdf') returning id`)).length, 1);
  assert.ok(await fails(T_USER, `insert into storage.objects(bucket_id, name) values ('evidence','${B_CO}/x/f.pdf')`));
  assert.ok(await fails(T_USER, `insert into storage.objects(bucket_id, name) values ('evidence','not-a-company/f.pdf')`));
  assert.ok(await fails(W_USER, `insert into storage.objects(bucket_id, name) values ('evidence','${W_CO}/f.pdf')`), "Watch-only clients have no evidence storage");
  assert.equal(await count(B_USER, "select count(*) from storage.objects"), 0);
  assert.equal(await count(STAFF, "select count(*) from storage.objects"), 1);
  assert.equal((await as(T_USER, "delete from storage.objects returning id")).length, 0);
});

test("app settings: emails ship off; staff read, only CGM admins change them; clients see nothing", async () => {
  const [s] = (await db.query(`select value from app_settings where key = 'emails_enabled'`)).rows;
  assert.equal(s.value, false);
  assert.equal(await count(STAFF, "select count(*) from app_settings"), 1);
  assert.equal(await count(T_ADMIN, "select count(*) from app_settings"), 0);
  assert.equal(await count(NOPLAN, "select count(*) from app_settings"), 0);
  assert.equal((await as(PM, `update app_settings set value = 'true' where key = 'emails_enabled' returning key`)).length, 0, "PM can't turn email on");
  assert.equal((await as(T_ADMIN, `update app_settings set value = 'true' where key = 'emails_enabled' returning key`)).length, 0);
  const [r] = await as(ADMIN, `update app_settings set value = 'true' where key = 'emails_enabled' returning updated_by`);
  assert.equal(r.updated_by, ADMIN);
  await as(ADMIN, `update app_settings set value = 'false' where key = 'emails_enabled'`);
});

// ---------- Accounts: invites, seats, onboarding (0007) ----------
const NEW_A = "60000000-0000-0000-0000-000000000001"; // will be invited to client A
const NEW_X = "60000000-0000-0000-0000-000000000002"; // nobody invited them

test("company admins invite colleagues; members, other companies and CGM staff (non-PM) can't", async () => {
  const [inv] = await as(T_ADMIN, `insert into invites(company_id, email) values ('${A_CO}','New@A.com') returning email, invited_by, company_role`);
  assert.equal(inv.email, "new@a.com", "addresses are stored lower case");
  assert.equal(inv.invited_by, T_ADMIN);
  assert.equal(inv.company_role, "member");
  assert.ok(await fails(T_USER, `insert into invites(company_id, email) values ('${A_CO}','m@a.com')`), "members can't invite");
  assert.ok(await fails(B_USER, `insert into invites(company_id, email) values ('${A_CO}','b2@a.com')`), "other companies can't");
  assert.ok(await fails(T_ADMIN, `insert into invites(company_id, email) values ('${B_CO}','x@b.com')`), "admins invite only into their own company");
  assert.ok(await fails(STAFF, `insert into invites(company_id, email) values ('${A_CO}','s@a.com')`), "CGM staff can't");
  assert.ok(await fails(T_ADMIN, `insert into invites(company_id, email) values ('${A_CO}','new@a.com')`), "no duplicate open invite");
  assert.ok(await fails(T_ADMIN, `insert into invites(company_id, email) values ('${A_CO}','t@a.com')`), "can't invite someone already on the team");

  assert.equal(await count(T_ADMIN, "select count(*) from invites"), 1);
  assert.equal(await count(T_USER, "select count(*) from invites"), 0, "members don't see invites");
  assert.equal(await count(B_USER, "select count(*) from invites"), 0);
  assert.equal(await count(STAFF, "select count(*) from invites"), 1, "staff see them");
  assert.equal((await as(T_ADMIN, `update invites set company_role = 'admin' returning id`)).length, 0, "invites can't be edited directly");
  assert.equal((await as(T_ADMIN, `delete from invites returning id`)).length, 0);
});

test("the invitee joins on sign-in; nobody else can take the invite", async () => {
  await db.exec(`insert into auth.users values ('${NEW_X}','stranger@x.com'),('${NEW_A}','new@a.com')`);
  assert.equal((await as(NEW_X, "select public.accept_invite() as c"))[0].c, null, "no invite for this address");
  assert.equal((await as(NEW_X, `select company_id from profiles where id = '${NEW_X}'`))[0].company_id, null);
  assert.equal(await count(NEW_X, "select count(*) from invites"), 0, "invitees can't read invites");

  const [{ c }] = await as(NEW_A, "select public.accept_invite() as c");
  assert.equal(c, "Client A");
  const [p] = await as(NEW_A, `select company_id, company_role, onboarded_at from profiles where id = '${NEW_A}'`);
  assert.equal(p.company_id, A_CO);
  assert.equal(p.company_role, "member");
  assert.equal(p.onboarded_at, null, "new people see the welcome screen");
  assert.equal(await count(NEW_A, "select count(*) from tasks"), await count(T_USER, "select count(*) from tasks"), "and now see their company's tasks");
  assert.equal((await as(NEW_A, "select public.accept_invite() as c"))[0].c, null, "accepting twice does nothing");
  const [i] = (await db.query(`select accepted_by from invites where email = 'new@a.com'`)).rows;
  assert.equal(i.accepted_by, NEW_A);
});

test("seat limits: members plus open invites can't pass the company's seats", async () => {
  await db.exec(`update companies set seats = 4 where id = '${A_CO}'`); // T_USER, T_ADMIN, NEW_A = 3 used
  await as(T_ADMIN, `insert into invites(company_id, email) values ('${A_CO}','fourth@a.com')`);
  assert.ok(await fails(T_ADMIN, `insert into invites(company_id, email) values ('${A_CO}','fifth@a.com')`), "full");
  assert.ok(await fails(T_ADMIN, `update companies set seats = 10 where id = '${A_CO}' returning id`) ||
    (await as(T_ADMIN, `update companies set seats = 10 where id = '${A_CO}' returning id`)).length === 0, "clients can't raise their seats");
  const [{ id }] = await as(T_ADMIN, `select id from invites where email = 'fourth@a.com'`);
  assert.ok(await fails(T_USER, `select public.revoke_invite('${id}')`), "members can't revoke");
  assert.ok(await fails(B_USER, `select public.revoke_invite('${id}')`), "other companies can't revoke");
  await as(T_ADMIN, `select public.revoke_invite('${id}')`);
  await as(T_ADMIN, `insert into invites(company_id, email) values ('${A_CO}','fifth@a.com')`); // the revoked seat is free again
  await as(PM, `select public.revoke_invite(id) from invites where email = 'fifth@a.com'`);
  await db.exec(`update companies set seats = 5 where id = '${A_CO}'`);
});

test("company admins remove colleagues from their own company only, never themselves", async () => {
  assert.ok(await fails(T_USER, `select public.remove_member('${NEW_A}')`), "members can't remove anyone");
  assert.ok(await fails(B_USER, `select public.remove_member('${NEW_A}')`), "other companies can't");
  assert.ok(await fails(T_ADMIN, `select public.remove_member('${B_USER}')`), "not people in other companies");
  assert.ok(await fails(T_ADMIN, `select public.remove_member('${T_ADMIN}')`), "not themselves");
  assert.ok(await fails(T_ADMIN, `select public.remove_member('${STAFF}')`), "not CGM staff");
  await as(T_ADMIN, `select public.remove_member('${NEW_A}')`);
  const [r] = (await db.query(`select company_id, company_role from profiles where id = '${NEW_A}'`)).rows;
  assert.equal(r.company_id, null);
  assert.equal(r.company_role, "member");
  assert.equal(await count(NEW_A, "select count(*) from tasks"), 0, "a removed person loses access at once");
  assert.equal((await as(T_ADMIN, `update profiles set company_id = null where id = '${T_USER}' returning id`))[0]?.id ?? T_USER, T_USER);
  assert.equal((await db.query(`select company_id from profiles where id = '${T_USER}'`)).rows[0].company_id, A_CO, "direct edits still can't change membership");
});

test("onboarding: users set their own functions, Regional Entity and onboarded time; region must be real", async () => {
  const [r] = await as(NEW_X, `update profiles set functions = '{GO,GOP}', region = 'SERC', onboarded_at = now() where id = '${NEW_X}' returning region, onboarded_at`);
  assert.equal(r.region, "SERC");
  assert.ok(r.onboarded_at);
  assert.ok(await fails(NEW_X, `update profiles set region = 'Mars' where id = '${NEW_X}'`));
});

// ---------- Delivery (0008) ----------
test("alerts are opt-in (0010): off by default; each person turns their own on; the alert log is staff-read, never API-written", async () => {
  const defaults = (await db.query(`select bool_or(alerts_opt_in) as any_on, bool_and(digest_opt_in) as all_digest from profiles`)).rows[0];
  assert.equal(defaults.any_on, false, "nobody gets alerts unless they ask");
  assert.equal(defaults.all_digest, true, "everyone gets the digest by default");
  const [r] = await as(W_USER, `update profiles set alerts_opt_in = true, digest_opt_in = false where id = '${W_USER}' returning alerts_opt_in, digest_opt_in`);
  assert.deepEqual([r.alerts_opt_in, r.digest_opt_in], [true, false]);
  assert.equal((await as(W_USER, `update profiles set alerts_opt_in = true where id = '${T_USER}' returning id`)).length, 0, "not someone else's");
  await db.exec(`update profiles set alerts_opt_in = false, digest_opt_in = true where id = '${W_USER}'`);

  await db.exec(`insert into alert_log(key, kind, label) values ('deadline:x:2099-01-01','deadline','Fake deadline')`);
  assert.equal(await count(STAFF, "select count(*) from alert_log"), 1);
  for (const u of [W_USER, T_ADMIN, NOPLAN]) assert.equal(await count(u, "select count(*) from alert_log"), 0, u);
  for (const u of [ADMIN, STAFF, T_ADMIN]) assert.ok(await fails(u, `insert into alert_log(key, kind, label) values ('k-${u}','ferc','x')`), u);
});

test("drafts keep the value they replaced, visible to editors only", async () => {
  await db.exec(`insert into drafts(id, section, op, key, status, previous) values ('d-prev','items','upsert','eop-004-5','approved','{"effective":"2099-01-01"}')`);
  assert.equal(await count(ADMIN, "select count(*) from drafts where previous is not null"), 1);
  for (const u of [PM, STAFF, W_USER]) assert.equal(await count(u, "select count(*) from drafts where previous is not null"), 0, u);
});

test("weekly drafting job runs: editors read them; nobody else, and nobody writes through the API (0011)", async () => {
  await db.exec(`insert into watch_job_runs(trigger, status, summary) values ('manual','skipped','Fake run')`);
  assert.equal(await count(ADMIN, "select count(*) from watch_job_runs"), 1);
  for (const u of [PM, STAFF, W_USER, T_ADMIN, NOPLAN]) assert.equal(await count(u, "select count(*) from watch_job_runs"), 0, u);
  for (const u of [ADMIN, PM, W_USER]) assert.ok(await fails(u, `insert into watch_job_runs(trigger) values ('manual')`), u);
  assert.equal((await as(ADMIN, `update watch_job_runs set status = 'ok' returning id`)).length, 0);
});

// ---------- T1: standards library and clients screens ----------
test("library: PMs and admins edit standards and confirm recurrence; staff and clients can't", async () => {
  await db.exec(`insert into obligation_templates(standard_code, req, title, recur_n, recur_unit, recur_basis) values ('PRC-005','R3','Fake battery check',6,'m','due')`);
  const [r] = await as(PM, `update library_standards set version = '7' where code = 'PRC-005' returning version`);
  assert.equal(r.version, "7");
  assert.equal((await as(STAFF, `update library_standards set version = '9' where code = 'PRC-005' returning code`)).length, 0, "staff can't");
  assert.equal((await as(T_ADMIN, `update library_standards set version = '9' where code = 'PRC-005' returning code`)).length, 0, "clients can't");
  assert.equal((await as(PM, `update obligation_templates set recur_basis = 'done', basis_confirmed = true where title = 'Fake battery check' returning id`)).length, 1);
  assert.equal((await as(STAFF, `update obligation_templates set basis_confirmed = false where title = 'Fake battery check' returning id`)).length, 0);
  assert.ok(await fails(STAFF, `insert into library_standards(code, version, title, family) values ('FAK-001','1','Fake','FAK')`));
  assert.equal((await as(ADMIN, `insert into library_standards(code, version, title, family, custom) values ('FAK-001','1','Fake','FAK',true) returning code`)).length, 1);
  assert.ok(await fails(ADMIN, `insert into library_standards(code, version, title, family) values ('fake bad','1','x','x')`), "number format is enforced");
  assert.equal((await as(ADMIN, `delete from library_standards where code = 'FAK-001' returning code`)).length, 1);
  await db.exec(`update library_standards set version = '6' where code = 'PRC-005'; delete from obligation_templates where title = 'Fake battery check'`);
});

test("clients: PMs add and edit clients, staff only read; any staff keeps contacts; only admins change products or delete", async () => {
  const [c] = await as(PM, `insert into companies(name, functions, entities) values ('Fake New Client', '{GO,GOP}', '{"rc":"Fake RC"}') returning id`);
  assert.equal((await as(PM, `update companies set ncr_id = 'NCR99999' where id = '${c.id}' returning ncr_id`))[0].ncr_id, "NCR99999");
  assert.equal((await as(STAFF, `update companies set ncr_id = 'X' where id = '${c.id}' returning id`)).length, 0, "staff can't edit clients");
  assert.equal(await count(STAFF, `select count(*) from companies where id = '${c.id}'`), 1, "but can see them");
  assert.equal((await as(T_ADMIN, `update companies set name = 'X' where id = '${A_CO}' returning id`)).length, 0, "clients can't edit their record");
  assert.equal((await as(STAFF, `insert into contacts(company_id, kind, name, email) values ('${c.id}','pm','Fake PM','pm@fake.example') returning id`)).length, 1);
  assert.ok(await fails(T_ADMIN, `insert into contacts(company_id, kind, name) values ('${A_CO}','compliance','Me')`), "clients can't add contacts");
  assert.ok(await fails(PM, `insert into entitlements(company_id, product) values ('${c.id}','tracker')`), "PMs can't switch the Tracker on");
  assert.equal((await as(ADMIN, `insert into entitlements(company_id, product) values ('${c.id}','tracker') returning product`)).length, 1);
  assert.equal((await as(PM, `delete from companies where id = '${c.id}' returning id`)).length, 0, "PMs can't delete clients");
  assert.equal((await as(ADMIN, `delete from companies where id = '${c.id}' returning id`)).length, 1);
  assert.equal(Number((await db.query(`select count(*) from contacts where company_id = '${c.id}'`)).rows[0].count), 0, "contacts go with the client");
});
