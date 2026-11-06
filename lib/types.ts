/** Registered functions a subscriber can choose. */
export const FUNCTIONS = { gen: ["GO", "GOP"], tx: ["TO", "TOP", "TP", "PC"] } as const;
export const ALL_FUNCTIONS: string[] = [...FUNCTIONS.gen, ...FUNCTIONS.tx];

export const TOPICS: Record<string, string> = {
  ibr: "Inverter-based resources",
  cip: "Security (CIP)",
  model: "Modeling, data & planning",
  ops: "Operations & events",
  load: "Large loads",
};

/** A standard as the app (and the Monday task's drafts) describe it. */
export type Item = {
  id: string;
  std: string;
  title: string;
  fn: string[];
  topic: string;
  effective?: string | null;
  ferc?: string | null;
  order_no?: string | null;
  status?: "dev" | null;
  stage?: string | null;
  phasing?: boolean;
  milestones: { d: string; l: string }[];
  what?: string | null;
  todo?: string | null;
  todoTx?: string | null;
  news: { d: string; t: string }[];
  src: string[];
  pos?: number | null;
};

export type Deadline = { id: string; d: string; t: string; who?: string | null; fn?: string[] | null };
export type Action = { id: string; d: string; src: "FERC" | "NERC"; t: string; pos?: number | null };
export type Source = { key: string; t: string; u?: string | null };
export type Week = { label: string; covers?: string | null; items: { b?: string; t: string }[] };

export type Content = {
  reviewed: string | null;
  week: Week | null;
  items: Item[];
  deadlines: Deadline[];
  actions: Action[];
  sources: Record<string, Source>;
};

export type DraftSection = "items" | "deadlines" | "activity" | "sources" | "week";

export type Draft = {
  id: string;
  section: DraftSection;
  op: "upsert" | "remove";
  key: string;
  label: string | null;
  reason: string | null;
  refs: { t?: string; u?: string }[];
  value: Record<string, unknown> | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  created_by: string | null;
};

/** NERC Regional Entities, as stored in companies.region and profiles.region. */
export const REGIONS = ["MRO", "NPCC", "RF", "SERC", "Texas RE", "WECC"] as const;
