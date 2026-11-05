import type { SupabaseClient } from "@supabase/supabase-js";
import type { Draft } from "./types";
import { actionValueToRow, deadlineValueToRow, itemValueToRow, sourceValueToRow, weekValueToRow } from "./mapping";
import { isoToday } from "./watch";

const TABLE: Record<string, { table: string; key: string }> = {
  items: { table: "standards", key: "id" },
  deadlines: { table: "deadlines", key: "id" },
  activity: { table: "actions", key: "id" },
  sources: { table: "sources", key: "key" },
};

/** Applies one approved draft to the published tables. `value` overrides the draft's value when the
 *  editor changed it before approving. Throws on any database error. */
export async function applyDraft(db: SupabaseClient, d: Draft, value?: Record<string, unknown> | null) {
  const v = (value ?? d.value ?? {}) as Record<string, unknown>;

  if (d.section === "week") {
    if (d.op === "upsert") {
      const { error } = await db.from("weekly_summaries").insert(weekValueToRow(v));
      if (error) throw new Error(error.message);
    }
  } else {
    const t = TABLE[d.section];
    if (!t) throw new Error(`Unknown section ${d.section}`);
    if (d.op === "remove") {
      const { error } = await db.from(t.table).delete().eq(t.key, d.key);
      if (error) throw new Error(error.message);
    } else {
      let row: Record<string, unknown>;
      if (d.section === "items") {
        row = itemValueToRow(d.key, v);
        if (row.pos == null) {
          const { data: cur } = await db.from("standards").select("pos").eq("id", d.key).maybeSingle();
          if (cur && typeof cur.pos === "number") row.pos = cur.pos;
          else {
            const { count } = await db.from("standards").select("id", { count: "exact", head: true });
            row.pos = count ?? 0;
          }
        }
      } else if (d.section === "deadlines") row = deadlineValueToRow(d.key, v);
      else if (d.section === "activity") row = actionValueToRow(d.key, v);
      else row = sourceValueToRow(d.key, v);
      const { error } = await db.from(t.table).upsert(row);
      if (error) throw new Error(error.message);
    }
  }

  const { error } = await db.from("site_meta").update({ reviewed: isoToday(), updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw new Error(error.message);
}
