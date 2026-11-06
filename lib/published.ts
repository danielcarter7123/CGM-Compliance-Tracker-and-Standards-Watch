import type { SupabaseClient } from "@supabase/supabase-js";
import { itemToValue, rowToItem } from "./mapping";
import type { DraftSection } from "./types";

/** The published value of one Watch entry, in the draft shape, or null when it isn't published. */
export async function publishedValue(db: SupabaseClient, section: DraftSection, key: string): Promise<Record<string, unknown> | null> {
  if (section === "items") {
    const { data } = await db.from("standards").select("*").eq("id", key).maybeSingle();
    return data ? (itemToValue(rowToItem(data)) as Record<string, unknown>) : null;
  }
  if (section === "deadlines") {
    const { data } = await db.from("deadlines").select("*").eq("id", key).maybeSingle();
    return data ? { d: data.d, t: data.title, who: data.who, fn: data.functions } : null;
  }
  if (section === "activity") {
    const { data } = await db.from("actions").select("*").eq("id", key).maybeSingle();
    return data ? { d: data.d, src: data.src, t: data.text } : null;
  }
  if (section === "sources") {
    const { data } = await db.from("sources").select("*").eq("key", key).maybeSingle();
    return data ? { t: data.title, u: data.url } : null;
  }
  const { data } = await db.from("weekly_summaries").select("*").order("published_at", { ascending: false }).limit(1);
  return data && data[0] ? { label: data[0].label, covers: data[0].covers, items: data[0].items } : null;
}
