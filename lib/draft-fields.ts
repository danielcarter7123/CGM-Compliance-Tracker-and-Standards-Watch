import { ALL_FUNCTIONS, TOPICS, type DraftSection } from "./types";

/* The fields of each Watch draft section, in the pilot's draft shape (CLAUDE.md rule 5: the shape
   doesn't change). Used by the review queue's Edit form, by its before/after labels, and to check an
   edited value on the server before it is published. Unknown keys in a draft are kept as they are. */

export type FieldKind =
  | "text" | "long" | "date" | "month-or-date" | "url"
  | "functions" | "topic" | "phase" | "bool" | "src-select" | "source-keys"
  | "dated" | "week-items";

export type Field = { k: string; label: string; kind: FieldKind; required?: boolean; hint?: string; sub?: "l" | "t" };

export const FIELDS: Record<DraftSection, Field[]> = {
  items: [
    { k: "std", label: "Standard", kind: "text", required: true, hint: "As NERC writes it, e.g. EOP-004-5" },
    { k: "title", label: "Title", kind: "text", required: true },
    { k: "fn", label: "Functions", kind: "functions", required: true },
    { k: "topic", label: "Topic", kind: "topic", required: true },
    { k: "status", label: "Stage", kind: "phase", hint: "In development, or approved with an effective date" },
    { k: "stage", label: "Development stage", kind: "text", hint: "Only while in development, e.g. a comment period" },
    { k: "effective", label: "U.S. effective date", kind: "date" },
    { k: "ferc", label: "FERC approval", kind: "month-or-date", hint: "YYYY-MM-DD, or YYYY-MM if only the month is known" },
    { k: "order_no", label: "FERC order or docket", kind: "text" },
    { k: "phasing", label: "Requirements phase in after the effective date", kind: "bool" },
    { k: "what", label: "What changes", kind: "long", required: true },
    { k: "todo", label: "What to do (GO/GOP)", kind: "long" },
    { k: "todoTx", label: "What to do (TO/TOP/TP/PC)", kind: "long" },
    { k: "milestones", label: "Milestones", kind: "dated", sub: "l" },
    { k: "news", label: "Latest news", kind: "dated", sub: "t" },
    { k: "src", label: "Sources", kind: "source-keys" },
  ],
  deadlines: [
    { k: "d", label: "Date", kind: "date", required: true },
    { k: "t", label: "What", kind: "long", required: true },
    { k: "who", label: "Who it's for", kind: "text" },
    { k: "fn", label: "Functions (none = everyone)", kind: "functions" },
  ],
  activity: [
    { k: "d", label: "Date", kind: "month-or-date", required: true },
    { k: "src", label: "Source", kind: "src-select", required: true },
    { k: "t", label: "What happened", kind: "long", required: true },
  ],
  sources: [
    { k: "t", label: "Title", kind: "text", required: true },
    { k: "u", label: "Link", kind: "url" },
  ],
  week: [
    { k: "label", label: "Heading", kind: "text", required: true, hint: "e.g. Week of Nov 2, 2026" },
    { k: "covers", label: "Covers", kind: "text" },
    { k: "items", label: "Points", kind: "week-items" },
  ],
};

export const fieldLabel = (section: string, k: string) =>
  FIELDS[section as DraftSection]?.find((f) => f.k === k)?.label ?? k;

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const realDate = (s: string) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const empty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

/** Problems that would stop an edited draft from being published. Empty when it's fine. */
export function draftProblems(section: DraftSection, v: Record<string, unknown>, sourceKeys?: string[]): string[] {
  const out: string[] = [];
  for (const f of FIELDS[section] || []) {
    const x = v[f.k];
    if (f.required && empty(x)) { out.push(`${f.label} is required.`); continue; }
    if (empty(x)) continue;
    switch (f.kind) {
      case "date":
        if (typeof x !== "string" || !realDate(x)) out.push(`${f.label} must be a real date as YYYY-MM-DD.`);
        break;
      case "month-or-date":
        if (typeof x !== "string" || !(realDate(x) || MONTH.test(x))) out.push(`${f.label} must be YYYY-MM-DD or YYYY-MM.`);
        break;
      case "url":
        if (typeof x !== "string" || !/^https:\/\/\S+$/.test(x)) out.push(`${f.label} must start with https://.`);
        break;
      case "functions":
        if (!Array.isArray(x) || x.some((y) => !ALL_FUNCTIONS.includes(String(y)))) out.push(`${f.label} must be from ${ALL_FUNCTIONS.join(", ")}.`);
        break;
      case "topic":
        if (!(String(x) in TOPICS)) out.push(`${f.label} must be one of the Watch topics.`);
        break;
      case "src-select":
        if (x !== "FERC" && x !== "NERC") out.push(`${f.label} must be FERC or NERC.`);
        break;
      case "source-keys":
        if (!Array.isArray(x)) out.push(`${f.label} must be a list.`);
        else if (sourceKeys) {
          const unknown = x.filter((k) => !sourceKeys.includes(String(k)));
          if (unknown.length) out.push(`Unknown source ${unknown.join(", ")}. Add the source first, or remove it here.`);
        }
        break;
      case "dated":
        if (!Array.isArray(x)) out.push(`${f.label} must be a list.`);
        else x.forEach((r: Record<string, unknown>, i) => {
          if (!r || typeof r.d !== "string" || !realDate(r.d)) out.push(`${f.label} row ${i + 1}: date must be YYYY-MM-DD.`);
          if (!r || empty(r[f.sub as string])) out.push(`${f.label} row ${i + 1}: text is required.`);
        });
        break;
      case "week-items":
        if (!Array.isArray(x)) out.push(`${f.label} must be a list.`);
        else x.forEach((r: Record<string, unknown>, i) => { if (!r || empty(r.t)) out.push(`${f.label} row ${i + 1}: text is required.`); });
        break;
    }
  }
  if (section === "items") {
    if (v.status === "dev" && !empty(v.effective)) out.push("A standard in development can't have an effective date. Clear one of them.");
    if (v.status !== "dev" && empty(v.effective)) out.push("An approved standard needs its U.S. effective date (or mark it In development).");
  }
  return out;
}

/** Drops empty optional keys the form produced, so the saved value looks like a Monday-task draft. */
export function tidyDraftValue(section: DraftSection, v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...v };
  for (const f of FIELDS[section] || []) {
    if (f.required) continue;
    if (f.kind === "functions" && section === "deadlines" && Array.isArray(out[f.k]) && !(out[f.k] as unknown[]).length) { out[f.k] = null; continue; }
    if (out[f.k] === "" || out[f.k] === false || (Array.isArray(out[f.k]) && !(out[f.k] as unknown[]).length && f.kind !== "source-keys")) delete out[f.k];
  }
  if (section === "items" && out.status !== "dev") delete out.status;
  return out;
}
