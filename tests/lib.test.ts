// Unit tests for the content mapping, status classification and digest, using the pilot's real content.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as m from "../lib/mapping";
import { classify, parseDate } from "../lib/watch";
import { digestSubject, renderDigest, renderDigestText } from "../lib/digest";
import type { Content } from "../lib/types";

const pilot = JSON.parse(readFileSync(new URL("../data/pilot-content.json", import.meta.url), "utf8"));

function contentFromPilot(): Content {
  const row = <T,>(o: Record<string, T>) => Object.entries(o);
  return {
    reviewed: pilot.reviewed,
    week: pilot.week,
    sources: row(pilot.sources).map(([k, v]: [string, any]) => m.rowToSource(m.sourceValueToRow(k, v))),
    items: row(pilot.items).map(([k, v]: [string, any]) => m.rowToItem(m.itemValueToRow(k, v))),
    deadlines: row(pilot.deadlines).map(([k, v]: [string, any]) => m.rowToDeadline(m.deadlineValueToRow(k, v))),
    activity: row(pilot.activity).map(([k, v]: [string, any]) => m.rowToAction(m.actionValueToRow(k, v))),
  } as unknown as Content;
}

test("every pilot item survives the round trip to a database row and back", () => {
  for (const [k, v] of Object.entries<any>(pilot.items)) {
    const back = m.rowToItem(m.itemValueToRow(k, v)) as any;
    assert.equal(back.std, v.std, k);
    assert.deepEqual(back.fn ?? back.functions, v.fn, k);
    assert.equal(back.effective ?? undefined, v.effective, k);
  }
});

test("classification puts each item in exactly one section", () => {
  const today = parseDate("2026-11-05");
  const items = contentFromPilot().items;
  const c = classify(items, today);
  assert.equal(c.length, items.length);
  const phase = Object.fromEntries(c.map((i) => [i.std, i.phase]));
  assert.equal(phase["EOP-004-5"], "upcoming");
  assert.equal(phase["Project 2026-03"], "dev");
  assert.equal(phase["PRC-029-2"], "implementing"); // in effect, later milestones still ahead
  assert.equal(phase["TOP-003-7"], "recent");
});

test("digest renders for each function group and filters transmission-only items", () => {
  const content = contentFromPilot();
  const all = renderDigest(content, [], "https://example.test");
  const gen = renderDigest(content, ["GO", "GOP"], "https://example.test");
  const tx = renderDigest(content, ["TO", "TOP", "TP", "PC"], "https://example.test");
  assert.ok(all.length > gen.length);
  assert.ok(!gen.includes("TPL-008-1"), "TP/PC-only standard should not reach a GO/GOP digest");
  assert.ok(tx.includes("TPL-008-1") || tx.length > 0);
  assert.match(digestSubject(content), /Week of/);
});

test("entitlement rules: separate apps; Client Tasks needs a live Tracker; same as SQL company_has", async () => {
  const { productsFrom } = await import("../lib/entitlements");
  const none = { watch: false, tracker: false, client_tasks: false, powerworks: false };
  assert.deepEqual(productsFrom([{ product: "watch", status: "active" }]), { ...none, watch: true });
  assert.deepEqual(productsFrom([{ product: "tracker", status: "trialing" }]), { ...none, tracker: true }, "the Tracker no longer includes Watch");
  assert.deepEqual(productsFrom([{ product: "tracker", status: "canceled" }, { product: "client_tasks", status: "active" }]), none);
  assert.deepEqual(productsFrom([{ product: "tracker", status: "active" }, { product: "client_tasks", status: "active" }]), { ...none, tracker: true, client_tasks: true });
  assert.deepEqual(productsFrom([{ product: "powerworks", status: "active" }]), { ...none, powerworks: true });

  // Compare with SQL company_has on every combination of live products.
  const { freshDb } = await import("./helpers/pg.mjs");
  const db = await freshDb();
  const prods = ["watch", "tracker", "client_tasks", "powerworks"] as const;
  for (let mask = 0; mask < 16; mask++) {
    const ents = prods.filter((_, i) => mask & (1 << i)).map((product) => ({ product, status: "active" }));
    const id = (await db.query<{ id: string }>("insert into companies(name) values ('Fake combo') returning id")).rows[0].id;
    for (const e of ents) await db.query("insert into entitlements(company_id, product, status) values ($1,$2,'active')", [id, e.product]);
    const ts = productsFrom(ents as any);
    for (const p of prods) {
      const sql = (await db.query<{ ok: boolean }>("select public.company_has($1, $2) as ok", [id, p])).rows[0].ok;
      assert.equal(ts[p], sql, `mask ${mask} product ${p}`);
    }
  }
});

test("the CGM standards library loads into the tracker tables", async () => {
  // @ts-ignore: plain JS helper shared with the .mjs tests
  const { freshDb } = await import("./helpers/pg.mjs");
  const { libraryRows } = await import("../scripts/import-library");
  const db = await freshDb();
  const lib = JSON.parse(readFileSync(new URL("../data/tracker-standards-library.json", import.meta.url), "utf8"));
  const { std, tpl } = libraryRows(lib.standards);
  for (const s of std) {
    await db.query("insert into library_standards(code, version, title, family, applies, url, notes) values ($1,$2,$3,$4,$5,$6,$7)",
      [s.code, s.version, s.title, s.family, s.applies, s.url, s.notes]);
  }
  for (const t of tpl) {
    await db.query("insert into obligation_templates(standard_code, req, title, recur_n, recur_unit, recur_basis, basis_confirmed, pos) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [t.standard_code, t.req, t.title, t.recur_n, t.recur_unit, t.recur_basis, t.basis_confirmed, t.pos]);
  }
  const n = await db.query("select (select count(*) from library_standards)::int s, (select count(*) from obligation_templates)::int t");
  assert.equal((n.rows[0] as any).s, 48);
  assert.equal((n.rows[0] as any).t, 72);
});

test("function filters: GO hides CIP-014-4 and TPL-008-1; TP shows TPL-008-1 and hides EOP-004-5", async () => {
  const { matchesFunctions } = await import("../lib/watch");
  const items = contentFromPilot().items as any[];
  const shown = (sel: string[]) => new Set(items.filter((i) => matchesFunctions(i.fn, sel)).map((i) => i.std));
  const go = shown(["GO"]);
  assert.ok(!go.has("CIP-014-4"), "GO hides CIP-014-4");
  assert.ok(!go.has("TPL-008-1"), "GO hides TPL-008-1");
  assert.ok(go.has("EOP-004-5"), "GO shows EOP-004-5");
  const tp = shown(["TP"]);
  assert.ok(tp.has("TPL-008-1"), "TP shows TPL-008-1");
  assert.ok(!tp.has("EOP-004-5"), "TP hides EOP-004-5");
  assert.equal(shown([]).size, new Set(items.map((i) => i.std)).size, "All shows everything");
});

test("review queue checks: every published pilot entry passes unchanged; bad edits are caught", async () => {
  const { draftProblems, tidyDraftValue } = await import("../lib/draft-fields");
  const keys = Object.keys(pilot.sources);
  for (const [k, v] of Object.entries<any>(pilot.items)) assert.deepEqual(draftProblems("items", v, keys), [], `item ${k}`);
  for (const [k, v] of Object.entries<any>(pilot.deadlines)) assert.deepEqual(draftProblems("deadlines", v), [], `deadline ${k}`);
  for (const [k, v] of Object.entries<any>(pilot.activity)) assert.deepEqual(draftProblems("activity", v), [], `action ${k}`);
  for (const [k, v] of Object.entries<any>(pilot.sources)) assert.deepEqual(draftProblems("sources", v), [], `source ${k}`);
  if (pilot.week) assert.deepEqual(draftProblems("week", pilot.week), []);

  const item = { ...(Object.values<any>(pilot.items).find((i) => i.effective)) };
  assert.ok(draftProblems("items", { ...item, effective: "2027-02-30" }).some((p) => p.includes("real date")), "Feb 30 is refused");
  assert.ok(draftProblems("items", { ...item, fn: ["GO", "XX"] }).length > 0, "unknown function");
  assert.ok(draftProblems("items", { ...item, src: ["nope"] }, keys).some((p) => p.includes("Unknown source")));
  assert.ok(draftProblems("items", { ...item, status: "dev" }).some((p) => p.includes("in development")));
  assert.ok(draftProblems("items", { ...item, milestones: [{ d: "2027-01-01", l: "" }] }).some((p) => p.includes("row 1")));
  assert.ok(draftProblems("sources", { t: "x", u: "http://insecure.example" }).length > 0);
  assert.deepEqual(tidyDraftValue("deadlines", { d: "2027-01-01", t: "x", who: "", fn: [] }), { d: "2027-01-01", t: "x", fn: null });
});

test("digest: plain-text part matches the HTML, with corrections, unsubscribe link and disclaimer", () => {
  const content = contentFromPilot();
  const opts = { corrections: ["TEST-000-1: effective date changed from Jan 1, 2099 to Apr 1, 2099 (fake)."], unsubscribeUrl: "https://example.test/unsubscribe?u=x" };
  const html = renderDigest(content, ["GO", "GOP"], "https://example.test", opts);
  const text = renderDigestText(content, ["GO", "GOP"], "https://example.test", opts);
  for (const s of ["Corrections to earlier digests", "TEST-000-1: effective date changed", "awareness only", "https://example.test/unsubscribe?u=x"]) {
    assert.ok(html.includes(s), `html has ${s}`);
    assert.ok(text.toLowerCase().includes(s.toLowerCase()), `text has ${s}`);
  }
  assert.ok(!text.includes("<"), "no markup in the text part");
  assert.ok(!text.includes("TPL-008-1"), "text is filtered like the HTML");
  const none = renderDigestText(content, [], "https://example.test");
  assert.ok(!none.includes("CORRECTIONS"), "no corrections block when there are none");
});

test("corrections and alerts come from approved drafts and the values they replaced", async () => {
  const { correctionLines, dueAlerts } = await import("../lib/changes");
  const today = parseDate("2099-03-01");
  const at = "2099-02-25T15:00:00Z";
  const drafts = [
    { id: "a", section: "items", op: "upsert", key: "test-1", label: null, decided_at: at,
      previous: { std: "TEST-000-1", effective: "2099-01-01", milestones: [{ d: "2099-06-01", l: "Phase 2" }, { d: "2099-09-01", l: "Phase 3" }] },
      value: { std: "TEST-000-1", fn: ["GO"], effective: "2099-04-01", milestones: [{ d: "2099-07-01", l: "Phase 2" }] } },
    { id: "b", section: "items", op: "upsert", key: "test-2", label: null, decided_at: at, previous: null,
      value: { std: "TEST-000-2", fn: ["TP"], ferc: "2099-02-20", effective: "2099-10-01", title: "Fake" } },
    { id: "c", section: "deadlines", op: "remove", key: "dl-1", label: null, decided_at: at, previous: { d: "2099-02-10", t: "Fake comments close" }, value: null },
    { id: "old", section: "items", op: "upsert", key: "test-3", label: null, decided_at: "2099-01-01T00:00:00Z", previous: null, value: { std: "TEST-000-3", ferc: "2098-12-01", effective: "2099-07-01" } },
  ] as any[];
  const lines = correctionLines(drafts);
  assert.deepEqual(lines, [
    "TEST-000-1: U.S. effective date changed from Jan 1, 2099 to Apr 1, 2099.",
    'TEST-000-1: "Phase 2" moved from Jun 1, 2099 to Jul 1, 2099.',
    'TEST-000-1: milestone "Phase 3" (Sep 1, 2099) was removed.',
    "Fake comments close (Feb 10, 2099) was removed.",
  ]);
  const deadlines = [
    { id: "soon", d: "2099-03-10", t: "Fake ballot closes", fn: ["GO"] },
    { id: "later", d: "2099-04-30", t: "Fake later", fn: null },
    { id: "past", d: "2099-02-01", t: "Fake past", fn: null },
  ];
  const alerts = dueAlerts(drafts, deadlines as any, new Set(), today);
  assert.deepEqual(alerts.map((a) => a.key), ["effective:a", "ferc:b", "effective:b", "deadline:soon:2099-03-10"], "old drafts and far deadlines don't alert");
  assert.match(alerts[0].label, /moved from Jan 1, 2099 to Apr 1, 2099/);
  assert.match(alerts[3].label, /in 9 days/);
  assert.equal(dueAlerts(drafts, deadlines as any, new Set(["ferc:b", "deadline:soon:2099-03-10"]), today).length, 2, "already-sent alerts don't repeat");
});

test("calendar feed: valid iCalendar, folded lines, stable UIDs, filtered by function", async () => {
  const ICAL = (await import("ical.js")).default;
  const { buildCalendar, fold } = await import("../lib/ical");
  const content = contentFromPilot();
  const today = parseDate("2026-11-05");
  const items = classify(content.items, today);
  const cal = buildCalendar({ items, deadlines: content.deadlines, functions: ["GO", "GOP"], site: "https://example.test", now: new Date("2026-11-05T12:00:00Z") });

  assert.ok(cal.endsWith("\r\n") && !/[^\r]\n/.test(cal), "every line ends in CRLF");
  for (const l of cal.split("\r\n")) assert.ok(Buffer.byteLength(l, "utf8") <= 75, `line too long: ${l}`);
  const comp = new ICAL.Component(ICAL.parse(cal));
  const evs = comp.getAllSubcomponents("vevent");
  assert.ok(evs.length > 5, "has events");
  const uids = evs.map((e: any) => e.getFirstPropertyValue("uid"));
  assert.equal(new Set(uids).size, uids.length, "UIDs are unique");
  const summaries = evs.map((e: any) => String(e.getFirstPropertyValue("summary")));
  assert.ok(!summaries.some((s: string) => s.startsWith("TPL-008-1")), "TP/PC-only standard isn't in a GO/GOP feed");
  for (const e of evs) assert.equal(e.getFirstProperty("dtstart")?.type, "date", "all-day events");

  const reversed = buildCalendar({ items: [...items].reverse(), deadlines: [...content.deadlines].reverse(), functions: ["GO", "GOP"], site: "https://example.test", now: new Date("2026-11-05T12:00:00Z") });
  const uids2 = new ICAL.Component(ICAL.parse(reversed)).getAllSubcomponents("vevent").map((e: any) => e.getFirstPropertyValue("uid"));
  assert.deepEqual([...uids2].sort(), [...uids].sort(), "UIDs don't depend on list order");

  const long = `SUMMARY:${"Ünïcode ".repeat(30)}`;
  const folded = fold(long);
  assert.equal(folded.replace(/\r\n /g, ""), long, "folding round-trips");
  assert.ok(folded.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75));
});

test("drafting job: a submission becomes drafts in the Monday task's shape, checked, deduplicated and safe", async () => {
  const { submissionToDrafts, estimateCost, JOB_AUTHOR } = await import("../lib/watch-job-core");
  const keys = Object.keys(pilot.sources);
  const good = { std: "TEST-000-1", title: "Fake standard", fn: ["GO"], topic: "ops", effective: "2099-01-01", what: "Test data.", src: [keys[0]] };
  const sub = {
    summary: "Fake week.", sources_checked: ["https://www.nerc.com/fake"], unconfirmed: [],
    drafts: [
      { section: "items", op: "upsert", key: "test-000-1", label: "TEST-000-1 (fake)", reason: "Fake.", refs: [{ t: "NERC", u: "https://www.nerc.com/fake" }, { t: "bad", u: "javascript:alert(1)" }], value_json: JSON.stringify(good) },
      { section: "items", op: "upsert", key: "test-000-2", label: "Bad date (fake)", reason: "Fake.", refs: [], value_json: JSON.stringify({ ...good, std: "TEST-000-2", effective: "2099-02-30" }) },
      { section: "items", op: "upsert", key: "test-000-3", label: "Not JSON", reason: "", refs: [], value_json: "{oops" },
      { section: "deadlines", op: "upsert", key: "already-waiting", label: "Dup", reason: "", refs: [], value_json: JSON.stringify({ d: "2099-01-01", t: "x", fn: null }) },
      { section: "items", op: "upsert", key: "test-000-1", label: "Same twice", reason: "", refs: [], value_json: JSON.stringify(good) },
      { section: "week", op: "upsert", key: "anything", label: "Week (fake)", reason: "", refs: [], value_json: JSON.stringify({ label: "Week of Jan 5, 2099", items: [{ b: "Fake", t: "Nothing changed." }] }) },
      { section: "drop_table", op: "upsert", key: "x", label: "Weird", reason: "", refs: [], value_json: "{}" },
      { section: "sources", op: "remove", key: "oldSource", label: "Remove a source (fake)", reason: "", refs: [], value_json: "" },
    ],
  };
  const { rows, skipped } = submissionToDrafts(sub as any, { today: "2099-01-05", sourceKeys: keys, pending: [{ section: "deadlines", key: "already-waiting" }] });
  assert.deepEqual(rows.map((r) => r.id), ["2099-01-05-items-test-000-1", "2099-01-05-items-test-000-2", "2099-01-05-week-week", "2099-01-05-sources-oldSource"]);
  assert.equal(skipped.length, 4, skipped.join(" | "));
  assert.ok(rows.every((r) => r.created_by === JOB_AUTHOR && r.status === "pending"));
  assert.deepEqual(rows[0].refs, [{ t: "NERC", u: "https://www.nerc.com/fake" }], "only https links are kept");
  assert.equal(rows[0].reason, "Fake.");
  assert.match(rows[1].reason || "", /^Needs editing before approval: U\.S\. effective date must be a real date/);
  assert.equal(rows[2].key, "week");
  assert.equal(rows[3].value, null);
  assert.ok(Object.keys(rows[0]).sort().join() === ["created_by", "id", "key", "label", "op", "reason", "refs", "section", "status", "value"].join(), "draft row columns");
  assert.equal(estimateCost({ input: 100000, output: 10000, cacheRead: 200000, cacheWrite: 0, searches: 10 }), 0.74);
});

test("tasks: next-due preview agrees with SQL next_due, including month ends, leap years and calendar years", async () => {
  const { nextDuePreview } = await import("../lib/tasks");
  const { freshDb } = await import("./helpers/pg.mjs");
  const db = await freshDb();
  const cases: [string, number, "d" | "m" | "y"][] = [
    ["2026-01-31", 1, "m"], ["2028-01-31", 1, "m"], ["2026-03-31", 3, "m"], ["2026-08-31", 6, "m"], ["2026-11-30", 15, "m"],
    ["2026-12-15", 12, "m"], ["2026-05-10", 84, "m"], ["2026-02-28", 35, "d"], ["2028-02-28", 1, "d"], ["2026-12-31", 90, "d"],
    ["2026-06-15", 1, "y"], ["2026-01-01", 3, "y"], ["2026-12-31", 6, "y"],
  ];
  for (const [base, n, unit] of cases) {
    const { rows } = await db.query<{ d: string }>(`select public.next_due($1::date, $2, $3)::text as d`, [base, n, unit]);
    assert.equal(nextDuePreview(base, n, unit), rows[0].d, `${base} + ${n}${unit}`);
  }
});

test("tasks: states, reminders, filters and CSV follow the pilot", async () => {
  const t = await import("../lib/tasks");
  const today = parseDate("2026-11-05");
  const base = { id: "x", company_id: "c1", title: "Fake battery check", facility: "Unit 1", standard_code: "PRC-005", requirement: "R3", due_date: "2026-11-20",
    assignee_text: "Fake Tech", remind_days: [30, 7], recur_n: 6, recur_unit: "m", recur_basis: "due", status: "open", evidence: null, notes: null,
    completed_at: null, performed_by: null, reviewed_at: null, reviewed_by: null, prev_id: null, next_id: null, copied_from: null, sample: false } as any;
  assert.equal(t.taskState(base, today), "window");
  assert.equal(t.taskState({ ...base, due_date: "2027-03-01" }, today), "scheduled");
  assert.equal(t.taskState({ ...base, due_date: "2027-03-01", status: "inprogress" }, today), "inprogress");
  assert.equal(t.taskState({ ...base, due_date: "2026-11-01" }, today), "overdue");
  assert.equal(t.taskState({ ...base, due_date: null }, today), "nodate");
  assert.equal(t.pill({ ...base, status: "review", completed_at: "2026-11-03" }, today).cls, "reportdue");
  assert.equal(t.pill({ ...base, status: "review", evidence: "https://sharepoint.example/fake" }, today).cls, "review");
  assert.equal(t.whenText({ ...base, status: "review", completed_at: "2026-11-03" }, today), "Performed Nov 3, 2026 · report pending 2 days");
  assert.deepEqual(t.nextReminder({ ...base, due_date: "2026-12-20" }, today), { date: "2026-11-20", offset: 30 });
  assert.deepEqual(t.nextReminder({ ...base, due_date: "2026-11-30" }, today), { date: "2026-11-23", offset: 7 });
  assert.equal(t.nextReminder({ ...base, due_date: "2026-11-06" }, today), null);
  assert.deepEqual(t.defaultReminders("d"), [7, 1]);

  const rows = [
    { ...base, id: "a", due_date: "2026-12-01" },
    { ...base, id: "b", due_date: null },
    { ...base, id: "c", status: "done", completed_at: "2026-10-01" },
    { ...base, id: "d", status: "review", completed_at: "2026-11-01" },
    { ...base, id: "e", due_date: "2026-10-01", company_id: "c2", standard_code: "CIP-004" },
  ];
  const lookup = { clientName: (id: string) => (id === "c2" ? "Fake Other LLC" : "Fake Peaker LLC"), applies: (c: string | null) => (c === "CIP-004" ? ["GO"] : ["GO", "TO"]) };
  const ids = (f: any) => t.filterTasks(rows, f, lookup, today).map((r) => r.id);
  assert.deepEqual(ids({}), ["e", "d", "a", "b"], "open, by due date, no date last");
  assert.deepEqual(ids({ status: "done" }), ["c"]);
  assert.deepEqual(ids({ status: "nodate" }), ["b"]);
  assert.deepEqual(ids({ status: "noreport" }), ["d"]);
  assert.deepEqual(ids({ status: "overdue" }), ["e"]);
  assert.deepEqual(ids({ status: "all", fn: "TO" }), ["c", "d", "a", "b"], "function filter uses the standard's Applies to");
  assert.deepEqual(ids({ q: "other llc" }), ["e"], "search includes the client name");
  const csv = t.tasksCsv([rows[0]], { client: () => ({ name: "Fake Peaker LLC", ncr_id: "NCR00000" }), version: () => "6" }, today);
  assert.equal(csv.split("\r\n")[0], '"Client","NCR ID","Standard","Version","Requirement","Task","Facility","Assignee","Due date","Status","Repeats","Completed","Evidence","Notes"');
  assert.match(csv.split("\r\n")[1], /^"Fake Peaker LLC","NCR00000","PRC-005","6","R3","Fake battery check"/);
  assert.equal(t.taskKey({ title: " Fake Battery Check ", standard_code: "PRC-005", requirement: "R3" }), "fake battery check|PRC-005|r3");
});

test("dashboard: the pilot's tiles, reminders, by-client order and upcoming schedule (TRACKER-SPEC §3.2, §4)", async () => {
  const { dashboard, quarterStart, reminderTasks } = await import("../lib/dashboard");
  const today = parseDate("2026-11-05");
  assert.equal(quarterStart(today), "2026-10-01");
  assert.equal(quarterStart(parseDate("2026-01-01")), "2026-01-01");
  assert.equal(quarterStart(parseDate("2026-06-30")), "2026-04-01");
  const t = (o: any) => ({ id: o.id, company_id: o.c || "a", title: o.id, facility: null, standard_code: null, requirement: null, due_date: o.due ?? null,
    assignee_text: null, remind_days: o.rem || [30, 7], recur_n: 0, recur_unit: "m", recur_basis: "due", status: o.st || "open", evidence: o.ev || null,
    notes: null, completed_at: o.done || null, performed_by: null, reviewed_at: null, reviewed_by: null, prev_id: null, next_id: null, copied_from: null, sample: false }) as any;
  const tasks = [
    t({ id: "late", due: "2026-10-20" }),                                   // overdue
    t({ id: "late-b", c: "b", due: "2026-11-01" }),                          // overdue (client b)
    t({ id: "soon", due: "2026-11-20" }),                                    // in window, due ≤ 30
    t({ id: "edge30", due: "2026-12-05", rem: [7] }),                        // due in 30 days, not in its 7-day window
    t({ id: "far", due: "2027-03-01" }),                                     // upcoming
    t({ id: "far2", c: "b", due: "2027-01-15" }),                            // upcoming
    t({ id: "nodate" }),                                                     // needs a due date
    t({ id: "rev-old", st: "review", due: "2026-11-10", done: "2026-10-01" }),// pending review, no report
    t({ id: "rev-new", st: "review", due: "2026-11-10", done: "2026-11-02", ev: "https://sharepoint.example/fake" }),
    t({ id: "closedQ", st: "done", done: "2026-10-01" }),                    // closed this quarter (first day counts)
    t({ id: "closedOld", st: "done", done: "2026-09-30" }),                  // last quarter
  ];
  const d = dashboard(tasks, [{ id: "a", name: "Fake A" }, { id: "b", name: "Fake B" }, { id: "c", name: "Fake C" }], today);
  assert.equal(d.overdue, 2);
  assert.equal(d.due30, 2, "soon and edge30; pending review is left out");
  assert.deepEqual(d.review.map((x: any) => x.id), ["rev-old", "rev-new"], "oldest performed first");
  assert.equal(d.awaitingReport, 1);
  assert.equal(d.open, 9);
  assert.equal(d.closedThisQuarter, 1);
  assert.equal(d.qStart, "2026-10-01");
  assert.equal(d.noDueDate, 1);
  assert.deepEqual(reminderTasks(tasks, today).map((x: any) => x.id), ["late", "late-b", "soon"]);
  assert.deepEqual(d.byClient.map((r: any) => [r.client.name, r.open, r.reminders, r.overdue]), [
    ["Fake A", 7, 1, 1], ["Fake B", 2, 0, 1], ["Fake C", 0, 0, 0],
  ].sort((x: any, y: any) => y[3] - x[3] || y[2] - x[2]));
  assert.deepEqual(d.upcoming.map((m: any) => [m.label, m.tasks.map((x: any) => x.id)]), [
    ["December 2026", ["edge30"]], ["January 2027", ["far2"]], ["March 2027", ["far"]],
  ]);
});

test("team tasks: filters, stats, links and CSV follow the pilot", async () => {
  const { filterTeam, teamStats, parseLinks, teamCsv } = await import("../lib/team");
  const base = { description: null, owner_email: null, actual_date: null, links: [], created_at: "2026-01-01T00:00:00Z", created_by: null };
  const rows = [
    { ...base, id: "a", title: "Fake mine late", company_id: null, owner_id: "me", collaborators: [], planned_date: "2026-11-01", est_hours: 2.5, status: "inprogress" },
    { ...base, id: "b", title: "Fake collab", company_id: "c1", owner_id: "x", collaborators: ["me"], planned_date: "2026-12-01", est_hours: "1.25", status: "notstarted" },
    { ...base, id: "c", title: "Fake unassigned", company_id: "c1", owner_id: null, collaborators: [], planned_date: null, est_hours: null, status: "onhold" },
    { ...base, id: "d", title: "Fake done", company_id: null, owner_id: "me", collaborators: [], planned_date: "2026-10-01", actual_date: "2026-11-03", est_hours: 4, status: "done" },
  ] as import("../lib/team").TeamTask[];
  const ctx = { me: "me", today: "2026-11-06", clientName: (id: string | null) => (id ? "Fake Client" : "Internal"), personName: (id: string | null) => (id === "x" ? "Pat Fake" : id ? "Me" : "") };
  const ids = (f: Parameters<typeof filterTeam>[1]) => filterTeam(rows, f, ctx).map((t) => t.id);
  assert.deepEqual(ids({}), ["a", "b"]); // default: mine or collaborating, open
  assert.deepEqual(ids({ scope: "owned", status: "all" }), ["a", "d"]);
  assert.deepEqual(ids({ scope: "unassigned" }), ["c"]);
  assert.deepEqual(ids({ scope: "everyone", status: "late" }), ["a"]);
  assert.deepEqual(ids({ scope: "everyone", client: "none", status: "all" }), ["a", "d"]);
  assert.deepEqual(ids({ scope: "everyone", q: "pat fake" }), ["b"]);
  const s = teamStats(rows, "me", "2026-11-06");
  assert.deepEqual([s.mine, s.mineHours, s.late, s.open, s.openHours, s.doneThisMonth], [2, 3.75, 1, 3, 3.75, 1]);
  assert.deepEqual(parseLinks("Folder | https://example.com/a\nhttps://example.com/b\nhttp://bad.example"), {
    links: [{ label: "Folder", url: "https://example.com/a" }, { label: "", url: "https://example.com/b" }], refused: ["http://bad.example"],
  });
  const csv = teamCsv([rows[1]], ctx).split("\r\n");
  assert.equal(csv[0], '"Task","Description","Client","Assigned to","Collaborators","Estimated hours","Anticipated completion","Actual completion","Status","Links"');
  assert.equal(csv[1], '"Fake collab","","Fake Client","Pat Fake","Me","1.25","2026-12-01","","Not started",""');
});

test("activity log: field changes from before/after rows and pilot history; CSV has one row per change", async () => {
  const { changes, activityCsv, canRestore, canRevert } = await import("../lib/activity");
  const ctx = { personName: (id: string) => (id === "p1" ? "Pat Fake" : "Someone"), clientName: (id: string) => (id === "c1" ? "Fake Client" : "(removed client)") };
  const e = {
    id: 1, at: "2026-11-06T15:00:00Z", actor_id: "p1", action: "updated", kind: "task", target_id: "t1", company_id: "c1", label: "Fake relay test",
    old_row: { id: "t1", title: "Fake relay test", due_date: "2026-11-30", status: "open", assignee_id: null, updated_at: "a", next_id: null },
    new_row: { id: "t1", title: "Fake relay test", due_date: "2026-12-15", status: "review", assignee_id: "p1", updated_at: "b", next_id: "t2" },
    source: "app" as const, legacy: null, ref_id: null,
  };
  assert.deepEqual(changes(e, ctx), [
    { field: "Due date", from: "2026-11-30", to: "2026-12-15" },
    { field: "Status", from: "Open", to: "Performed, pending review" },
    { field: "Assignee", from: "", to: "Pat Fake" },
  ]);
  const legacy = { ...e, id: 2, source: "legacy" as const, old_row: null, new_row: null, legacy: { note: "Fake note", changes: [{ f: "dueDate", from: "2026-01-01", to: "2026-02-01" }] } };
  assert.deepEqual(changes(legacy, ctx), [{ field: "Due date", from: "2026-01-01", to: "2026-02-01" }]);
  assert.equal(canRevert(e), true);
  assert.equal(canRevert(legacy), false);
  assert.equal(canRestore({ ...e, action: "deleted" }), true);
  assert.equal(canRestore({ ...legacy, action: "deleted" }), false);
  const csv = activityCsv([e, legacy], { ...ctx, who: () => "Pat Fake", client: () => "Fake Client" }).split("\r\n");
  assert.equal(csv.length, 1 + 3 + 1);
  assert.equal(csv[0], '"When","Who","Action","Record type","Record","Client","Field","From","To","Note"');
  assert.equal(csv[1], '"2026-11-06T15:00:00Z","Pat Fake","Updated","Task","Fake relay test","Fake Client","Due date","2026-11-30","2026-12-15",""');
  assert.ok(csv[4].endsWith('"Due date","2026-01-01","2026-02-01","Fake note"'));
});

test("client tasks: states, filters, stats and CSV follow the pilot", async () => {
  const { ctState, ctWhen, filterCTasks, ctStats, ctCsv, ctRecur } = await import("../lib/clienttasks");
  const base = { description: null, notes: null, assigned_to: null, party: "client", priority: "normal", completed_at: null, recur_n: 0, recur_unit: "m",
    links: [], created_at: "", created_by: null, prev_id: null, next_id: null, company_id: "c1", category: null };
  const rows = [
    { ...base, id: "a", title: "Fake permit renewal", due_date: "2026-11-01", status: "inprogress", category: "Environmental" },
    { ...base, id: "b", title: "Fake safety walk", due_date: "2026-11-20", status: "notstarted", party: "contractor", priority: "high", recur_n: 3 },
    { ...base, id: "c", title: "Fake far task", due_date: "2027-03-01", status: "onhold", company_id: "c2" },
    { ...base, id: "d", title: "Fake done", due_date: "2026-10-01", status: "done", completed_at: "2026-11-02" },
  ] as import("../lib/clienttasks").CTask[];
  const today = "2026-11-06", name = (id: string) => (id === "c1" ? "Fake Peaker" : "Fake Other");
  assert.deepEqual(rows.map((t) => ctState(t, today)), ["overdue", "window", "onhold", "done"]);
  assert.equal(ctWhen(rows[0], today, (d) => d), "5 days overdue");
  assert.equal(ctWhen(rows[1], today, (d) => d), "Due in 14 days");
  assert.equal(ctWhen(rows[3], today, (d) => d), "Completed 2026-11-02");
  const ids = (f: Parameters<typeof filterCTasks>[1]) => filterCTasks(rows, f, today, name).map((t) => t.id);
  assert.deepEqual(ids({}), ["a", "b", "c"]);
  assert.deepEqual(ids({ status: "overdue" }), ["a"]);
  assert.deepEqual(ids({ status: "d30" }), ["b"]);
  assert.deepEqual(ids({ status: "all", client: "c1" }), ["a", "b", "d"]);
  assert.deepEqual(ids({ party: "contractor" }), ["b"]);
  assert.deepEqual(ids({ cat: "Environmental" }), ["a"]);
  assert.deepEqual(ids({ q: "fake other" }), ["c"]);
  const s = ctStats(rows, today);
  assert.deepEqual([s.overdue, s.due30, s.open, s.doneThisMonth], [1, 1, 3, 1]);
  assert.equal(ctStats(rows, today, "c2").open, 1);
  assert.equal(ctRecur(rows[1]), "Every 3 months");
  assert.equal(ctRecur({ recur_n: 1, recur_unit: "y" }), "Every year");
  const csv = ctCsv([rows[1]], name).split("\r\n");
  assert.equal(csv[0], '"Client","Task","Description","Category","Assigned to","Responsible party","Due date","Priority","Status","Completed","Repeats","Links","Notes"');
  assert.equal(csv[1], '"Fake Peaker","Fake safety walk","","","","Contractor / vendor","2026-11-20","High","Not started","","Every 3 months","",""');
});

test("tracker emails: digest sections, reminder timing (incl. Monday catch-up) and rendering", async () => {
  const m = await import("../lib/tracker-mail");
  const t = (id: string, due: string | null, status = "open", extra = {}) =>
    ({ id, company_id: "c1", title: `Fake ${id}`, standard_code: "PRC-005", requirement: "R3", facility: null, due_date: due, status, remind_days: [30, 7], evidence: null, ...extra }) as import("../lib/tracker-mail").MailTask;
  const today = "2026-11-06"; // a Friday
  const tasks = [t("late", "2026-11-01"), t("soon", "2026-11-20"), t("far", "2027-01-01"), t("nodate", null),
    t("perf", "2026-10-01", "review"), t("perfok", "2026-10-02", "review", { evidence: "https://example.com/r" }), t("up", "2026-10-03", "review", { has_evidence: true })];
  const s = m.digestSections(tasks, today);
  assert.deepEqual([s.overdue, s.due30, s.noReport, s.review].map((l) => l.map((x) => x.id)), [["late"], ["soon"], ["perf"], ["perfok", "up"]]);
  assert.equal(m.sectionCount(s), 5);

  // Reminders: window start, due date, every day overdue; nothing otherwise.
  assert.equal(m.taskReminder(t("a", "2026-12-06"), today), "due in 30 days");
  assert.equal(m.taskReminder(t("a", "2026-11-13"), today), "due in 7 days");
  assert.equal(m.taskReminder(t("a", "2026-11-12"), today), null);
  assert.equal(m.taskReminder(t("a", "2026-11-06"), today), "due today");
  assert.equal(m.taskReminder(t("a", "2026-11-04"), today), "2 days overdue");
  assert.equal(m.taskReminder(t("a", "2026-11-04", "review"), today), null);
  // Monday covers the weekend: a 7-day window that started Saturday or Sunday.
  assert.equal(m.lookbackDays("2026-11-09"), 3);
  assert.equal(m.lookbackDays("2026-11-10"), 1);
  assert.equal(m.taskReminder(t("a", "2026-11-14"), "2026-11-09", 3), "due in 5 days");
  assert.equal(m.taskReminder(t("a", "2026-11-13"), "2026-11-09", 3), null, "started the previous Friday: already sent");
  assert.equal(m.isWeekday("2026-11-07"), false);
  // Team tasks: 7 days before, on the day, while late.
  assert.equal(m.teamReminder({ status: "inprogress", planned_date: "2026-11-13" }, today), "anticipated in 7 days");
  assert.equal(m.teamReminder({ status: "inprogress", planned_date: "2026-11-10" }, today), null);
  assert.equal(m.teamReminder({ status: "notstarted", planned_date: "2026-11-06" }, today), "anticipated today");
  assert.equal(m.teamReminder({ status: "onhold", planned_date: "2026-11-05" }, today), "1 day past the anticipated date");
  assert.equal(m.teamReminder({ status: "done", planned_date: "2026-11-05" }, today), null);

  const d = m.renderClientDigest("Fake Client", s, "https://app.example", "https://app.example/unsubscribe?x=abc");
  assert.equal(d.subject, "Fake Client: 1 overdue, 1 due in 30 days, 1 missing a report · CGM Compliance Tracker");
  assert.ok(d.text.includes("OVERDUE (1)") && d.text.includes("Nov 1, 2026 · PRC-005 R3 · Fake late"));
  assert.ok(d.html.includes("https://app.example/tracker/tasks?status=all&amp;t=late") && d.html.includes("Unsubscribe"));
  assert.ok(!d.text.includes("Fake far") && !d.text.includes("Fake nodate"));
  const r = m.renderReminders([{ kind: "task", id: "x", title: "Fake <relay>", date: "2026-11-04", note: "2 days overdue", client: "Fake Client" }], "https://app.example", "u");
  assert.equal(r.subject, "Reminder: Fake <relay> is 2 days overdue");
  assert.ok(r.html.includes("Fake &lt;relay&gt;"), "escaped");
  assert.equal(m.renderMessagesNotice(2, "https://app.example", "u").subject, "You have unread messages · CGM Compliance Tracker");
});
