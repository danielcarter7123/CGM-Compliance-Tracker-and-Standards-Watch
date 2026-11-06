import { draftProblems, tidyDraftValue } from "./draft-fields";
import type { DraftSection } from "./types";

/* The pure half of the weekly drafting job: the submit tool Claude fills in, and turning its submission into
   draft rows in the pilot's draft shape (CLAUDE.md rule 5). No network or database here, so it's unit-tested. */

export const SECTIONS: DraftSection[] = ["items", "deadlines", "activity", "sources", "week"];
export const JOB_AUTHOR = "Weekly NERC job (Claude)";

/** The one tool Claude calls at the end. `value_json` is a JSON string because each section has its own shape;
 *  the app checks it against lib/draft-fields.ts afterwards. */
export const SUBMIT_TOOL = {
  name: "submit_drafts",
  description:
    "Submit this week's proposed Standards Watch changes for the editor to review. Call it exactly once, at the end. " +
    "Nothing is published by this call; every draft waits for the editor's approval.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["summary", "sources_checked", "unconfirmed", "drafts"],
    properties: {
      summary: { type: "string", description: "Two to five plain sentences for the editor: what you found this week and which bulletin you used." },
      sources_checked: { type: "array", items: { type: "string" }, description: "URLs you opened and relied on." },
      unconfirmed: { type: "array", items: { type: "string" }, description: "Things you saw but could not confirm from an official source, one per line." },
      drafts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["section", "op", "key", "label", "reason", "refs", "value_json"],
          properties: {
            section: { type: "string", enum: SECTIONS },
            op: { type: "string", enum: ["upsert", "remove"] },
            key: { type: "string", description: 'Entry id within the section. items: lowercase slug of the standard (e.g. "eop-004-5"); deadlines and activity: "<YYYY-MM-DD>-<short-slug>"; sources: short camelCase; week: "week".' },
            label: { type: "string" },
            reason: { type: "string" },
            refs: {
              type: "array",
              items: { type: "object", additionalProperties: false, required: ["t", "u"], properties: { t: { type: "string" }, u: { type: "string" } } },
            },
            value_json: { type: "string", description: 'The full new entry as a JSON object string, in the section\'s shape. Use "" for op "remove".' },
          },
        },
      },
    },
  },
};

export type Submission = {
  summary: string;
  sources_checked: string[];
  unconfirmed: string[];
  drafts: { section: string; op: string; key: string; label: string; reason: string; refs: { t: string; u: string }[]; value_json: string }[];
};

export type DraftRow = {
  id: string;
  section: DraftSection;
  op: "upsert" | "remove";
  key: string;
  label: string | null;
  reason: string | null;
  refs: { t: string; u: string }[];
  value: Record<string, unknown> | null;
  created_by: string;
  status: "pending";
};

const ID_OK = /^[A-Za-z0-9_-]{1,160}$/;
const slug = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");

export type Processed = { rows: DraftRow[]; skipped: string[] };

/** Submission -> draft rows. Ids follow the Monday task's "<date>-<section>-<key>", so if both run the same day the
 *  second copy is ignored. A draft whose value fails the editor's checks is still queued, with the problems at the
 *  start of its reason, so the editor fixes it with Edit first instead of losing it. */
export function submissionToDrafts(
  sub: Submission,
  ctx: { today: string; sourceKeys: string[]; pending: { section: string; key: string }[] },
): Processed {
  const rows: DraftRow[] = [];
  const skipped: string[] = [];
  const pending = new Set(ctx.pending.map((p) => `${p.section}:${p.key}`));
  const newSources = sub.drafts.filter((d) => d.section === "sources" && d.op === "upsert").map((d) => d.key);
  const sourceKeys = [...ctx.sourceKeys, ...newSources];

  for (const d of (sub.drafts || []).slice(0, 100)) {
    const label = String(d.label || d.key).slice(0, 200);
    if (!SECTIONS.includes(d.section as DraftSection)) { skipped.push(`${label}: unknown section "${d.section}".`); continue; }
    if (d.op !== "upsert" && d.op !== "remove") { skipped.push(`${label}: unknown operation "${d.op}".`); continue; }
    const section = d.section as DraftSection;
    const key = section === "week" ? "week" : String(d.key || "").trim();
    if (!key || key.length > 120) { skipped.push(`${label}: missing or too-long key.`); continue; }
    if (pending.has(`${section}:${key}`)) { skipped.push(`${label}: a draft for this entry is already waiting.`); continue; }

    let value: Record<string, unknown> | null = null;
    let reason = String(d.reason || "").trim();
    if (d.op === "upsert") {
      try {
        const parsed = JSON.parse(d.value_json);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        value = tidyDraftValue(section, parsed as Record<string, unknown>);
      } catch {
        skipped.push(`${label}: the proposed value wasn't valid JSON.`);
        continue;
      }
      const problems = draftProblems(section, value, sourceKeys);
      if (problems.length) reason = `Needs editing before approval: ${problems.join(" ")}${reason ? ` | ${reason}` : ""}`;
    }

    const id = `${ctx.today}-${section}-${slug(key)}`.slice(0, 160);
    if (!ID_OK.test(id)) { skipped.push(`${label}: couldn't make a safe id.`); continue; }
    if (rows.some((r) => r.id === id)) { skipped.push(`${label}: duplicate of another draft in this run.`); continue; }
    pending.add(`${section}:${key}`);
    rows.push({
      id, section, op: d.op, key, label,
      reason: reason.slice(0, 2000) || null,
      refs: (d.refs || []).filter((r) => r && /^https:\/\//.test(r.u)).slice(0, 10).map((r) => ({ t: String(r.t).slice(0, 200), u: String(r.u).slice(0, 500) })),
      value: d.op === "remove" ? null : value,
      created_by: JOB_AUTHOR,
      status: "pending",
    });
  }
  return { rows, skipped };
}

/** Rough cost of a run in US dollars at Claude Opus 5.5 list prices, plus web search at $10 per 1,000 searches.
 *  Shown to the editor as an estimate only; the Anthropic Console has the exact bill. */
export function estimateCost(u: { input: number; output: number; cacheRead: number; cacheWrite: number; searches: number }) {
  const usd = (u.input * 4 + u.output * 20 + u.cacheRead * 0.2 + u.cacheWrite * 5) / 1e6 + u.searches * 0.01;
  return Math.round(usd * 100) / 100;
}
