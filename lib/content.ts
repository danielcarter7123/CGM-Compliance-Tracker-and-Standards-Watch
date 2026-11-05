import type { SupabaseClient } from "@supabase/supabase-js";
import type { Content, Source } from "./types";
import { rowToAction, rowToDeadline, rowToItem, rowToSource, rowToWeek } from "./mapping";

/** Loads everything the Watch page shows. Row level security decides what the client may read. */
export async function loadContent(db: SupabaseClient): Promise<Content> {
  const [standards, deadlines, actions, sources, week, meta] = await Promise.all([
    db.from("standards").select("*"),
    db.from("deadlines").select("*").order("d"),
    db.from("actions").select("*"),
    db.from("sources").select("*"),
    db.from("weekly_summaries").select("*").order("published_at", { ascending: false }).limit(1),
    db.from("site_meta").select("reviewed").eq("id", 1).maybeSingle(),
  ]);
  const err = standards.error || deadlines.error || actions.error || sources.error || week.error || meta.error;
  if (err) throw new Error(err.message);

  const srcMap: Record<string, Source> = {};
  (sources.data || []).forEach((r) => {
    const s = rowToSource(r);
    srcMap[s.key] = s;
  });
  return {
    reviewed: (meta.data?.reviewed as string | null) ?? null,
    week: week.data && week.data[0] ? rowToWeek(week.data[0]) : null,
    items: (standards.data || []).map(rowToItem),
    deadlines: (deadlines.data || []).map(rowToDeadline),
    actions: (actions.data || []).map(rowToAction),
    sources: srcMap,
  };
}
