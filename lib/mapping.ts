import type { Action, Deadline, Item, Source, Week } from "./types";

/* Converts between database rows and the shapes the app and the Monday task's drafts use.
   Draft values use the pilot's field names (fn, todoTx, d/t), so the Monday task needs no change
   beyond where it posts. */

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function rowToItem(r: Json): Item {
  return {
    id: String(r.id),
    std: String(r.std),
    title: String(r.title),
    fn: arr<string>(r.functions),
    topic: String(r.topic),
    effective: str(r.effective),
    ferc: str(r.ferc),
    order_no: str(r.order_no),
    status: r.status === "dev" ? "dev" : null,
    stage: str(r.stage),
    phasing: !!r.phasing,
    milestones: arr(r.milestones),
    what: str(r.what),
    todo: str(r.todo),
    todoTx: str(r.todo_tx),
    news: arr(r.news),
    src: arr<string>(r.src),
    pos: typeof r.pos === "number" ? r.pos : null,
  };
}

/** A draft or pilot item value -> standards row. */
export function itemValueToRow(id: string, v: Json) {
  return {
    id,
    std: String(v.std ?? ""),
    title: String(v.title ?? ""),
    functions: arr<string>(v.fn),
    topic: String(v.topic ?? "ops"),
    effective: str(v.effective),
    ferc: str(v.ferc),
    order_no: str(v.order_no) ?? str(v.order),
    status: v.status === "dev" ? "dev" : null,
    stage: str(v.stage),
    phasing: !!v.phasing,
    milestones: arr(v.milestones),
    what: str(v.what),
    todo: str(v.todo),
    todo_tx: str(v.todoTx),
    news: arr(v.news),
    src: arr<string>(v.src),
    pos: typeof v.pos === "number" ? v.pos : null,
    updated_at: new Date().toISOString(),
  };
}

/** standards row -> draft-style value (for showing what a draft would change). */
export function itemToValue(i: Item): Json {
  const { id: _id, ...rest } = i;
  return rest as unknown as Json;
}

export const rowToDeadline = (r: Json): Deadline => ({
  id: String(r.id), d: String(r.d), t: String(r.title), who: str(r.who), fn: Array.isArray(r.functions) ? (r.functions as string[]) : null,
});
export const deadlineValueToRow = (id: string, v: Json) => ({
  id, d: String(v.d), title: String(v.t ?? ""), who: str(v.who), functions: Array.isArray(v.fn) ? v.fn : null,
});

export const rowToAction = (r: Json): Action => ({
  id: String(r.id), d: String(r.d), src: r.src === "FERC" ? "FERC" : "NERC", t: String(r.text), pos: typeof r.pos === "number" ? r.pos : null,
});
export const actionValueToRow = (id: string, v: Json) => ({
  id, d: String(v.d), src: v.src === "FERC" ? "FERC" : "NERC", text: String(v.t ?? ""), pos: typeof v.pos === "number" ? v.pos : null,
});

export const rowToSource = (r: Json): Source => ({ key: String(r.key), t: String(r.title), u: str(r.url) });
export const sourceValueToRow = (key: string, v: Json) => ({ key, title: String(v.t ?? key), url: str(v.u) });

export const rowToWeek = (r: Json): Week => ({ label: String(r.label), covers: str(r.covers), items: arr(r.items) });
export const weekValueToRow = (v: Json) => ({ label: String(v.label ?? ""), covers: str(v.covers), items: arr(v.items) });
