/* One registered-function vocabulary for the whole app (Dan's decision 5, OPEN-QUESTIONS).
   The Tracker uses all of them. Standards Watch filters on its six groups, with the Category 2 IBR
   registrations folded in: GO-2 counts as GO and GOP-2 as GOP. */

export const REGISTERED_FUNCTIONS = ["GO", "GOP", "GO-2", "GOP-2", "TO", "TOP", "TP", "PC"] as const;
export type RegisteredFunction = (typeof REGISTERED_FUNCTIONS)[number];

export const FUNCTION_NAMES: Record<RegisteredFunction, string> = {
  GO: "Generator Owner",
  GOP: "Generator Operator",
  "GO-2": "Generator Owner, Category 2 IBR",
  "GOP-2": "Generator Operator, Category 2 IBR",
  TO: "Transmission Owner",
  TOP: "Transmission Operator",
  TP: "Transmission Planner",
  PC: "Planning Coordinator",
};

const WATCH_GROUP: Record<string, string> = { "GO-2": "GO", "GOP-2": "GOP" };
const WATCH = ["GO", "GOP", "TO", "TOP", "TP", "PC"];

/** Registered functions -> the Standards Watch filter groups, without duplicates. */
export function toWatchFunctions(fns: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const f of fns || []) {
    const w = WATCH_GROUP[f] || f;
    if (WATCH.includes(w) && !out.includes(w)) out.push(w);
  }
  return out;
}

export const REGIONS = ["MRO", "NPCC", "RF", "SERC", "Texas RE", "WECC"] as const;

/** NERC functional entities a registered GO/GOP/TO coordinates with, keyed to the client's registered functions.
 *  Ported unchanged from the pilot tracker (CGM's own reference content). `why` lists the standards that drive
 *  each relationship. Stored on companies.entities as free text "Entity name / NCR ID". */
export const MAPPED_ENTITIES = [
  { k: "rc", label: "Reliability Coordinator", ab: "RC", fns: ["GO", "GOP", "GO-2", "GOP-2", "TO"], why: "IRO-001, IRO-010, COM-002, EOP-004" },
  { k: "ba", label: "Balancing Authority", ab: "BA", fns: ["GO", "GOP", "GO-2", "GOP-2"], why: "TOP-003, BAL-001-TRE, COM-001, COM-002, EOP-004" },
  { k: "top", label: "Transmission Operator", ab: "TOP", fns: ["GO", "GOP", "GO-2", "GOP-2", "TO"], why: "VAR-002, TOP-001, TOP-003, COM-001, COM-002, EOP-005" },
  { k: "tp", label: "Transmission Planner", ab: "TP", fns: ["GO", "GO-2", "TO"], why: "MOD-025, MOD-026, MOD-027, MOD-032, FAC-002, TPL-007, PRC-024" },
  { k: "pc", label: "Planning Coordinator", ab: "PC", fns: ["GO", "GO-2", "TO"], why: "MOD-032, FAC-002, TPL-007, PRC-006" },
  { k: "to", label: "Interconnecting Transmission Owner", ab: "TO", fns: ["GO", "GO-2"], why: "FAC-001, FAC-002, PRC-005, PRC-027, VAR-002 R5" },
  { k: "tsp", label: "Transmission Service Provider", ab: "TSP", fns: ["TO"], why: "FAC-002, MOD-001" },
  { k: "go", label: "Interconnected Generator Owner(s)", ab: "GO", fns: ["TO"], why: "FAC-001, PRC-027, PRC-005, MOD-032" },
  { k: "gop", label: "Interconnected Generator Operator(s)", ab: "GOP", fns: ["TO"], why: "COM-001, COM-002, TOP-003" },
] as const;

export const entitiesFor = (fns: readonly string[]) => MAPPED_ENTITIES.filter((e) => e.fns.some((f) => fns.includes(f)));

/** The default link for a standard: NERC's PDF for that number and version. */
export const nercPdf = (code: string, version: string) =>
  `https://www.nerc.com/pa/Stand/Reliability%20Standards/${encodeURIComponent(`${code}-${version}`)}.pdf`;
export const standardLink = (s: { code: string; version: string; url?: string | null }) =>
  s.url && /^https:\/\//i.test(s.url) ? s.url : nercPdf(s.code, s.version);
