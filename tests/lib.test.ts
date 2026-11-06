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

test("entitlement rules: Tracker includes Watch; Client Tasks needs a live Tracker", async () => {
  const { productsFrom } = await import("../lib/entitlements");
  assert.deepEqual(productsFrom([{ product: "watch", status: "active" }]), { watch: true, tracker: false, client_tasks: false });
  assert.deepEqual(productsFrom([{ product: "tracker", status: "trialing" }]), { watch: true, tracker: true, client_tasks: false });
  assert.deepEqual(productsFrom([{ product: "tracker", status: "canceled" }, { product: "client_tasks", status: "active" }]), { watch: false, tracker: false, client_tasks: false });
  assert.deepEqual(productsFrom([{ product: "tracker", status: "active" }, { product: "client_tasks", status: "active" }]), { watch: true, tracker: true, client_tasks: true });
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

test("corrections come from approved drafts and the values they replaced; new entries aren't corrections", async () => {
  const { correctionLines } = await import("../lib/changes");
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
