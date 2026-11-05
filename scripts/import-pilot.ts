/* One-time import of the pilot's published content into Supabase.
   Usage: npm run import:pilot            (reads data/pilot-content.json)
          npm run import:pilot -- path/to/content.json
   Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local. Safe to re-run: rows are upserted. */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { actionValueToRow, deadlineValueToRow, itemValueToRow, sourceValueToRow, weekValueToRow } from "../lib/mapping";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
type J = Record<string, Record<string, unknown>>;
const file = process.argv[2] || "data/pilot-content.json";
const c = JSON.parse(readFileSync(file, "utf8")) as { reviewed?: string; week?: Record<string, unknown>; sources?: J; items?: J; deadlines?: J; activity?: J };

async function up(table: string, rows: Record<string, unknown>[], onConflict: string) {
  if (!rows.length) return;
  const { error } = await db.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`${table}: ${rows.length}`);
}

(async () => {
  await up("sources", Object.entries(c.sources || {}).map(([k, v]) => sourceValueToRow(k, v)), "key");
  await up("standards", Object.entries(c.items || {}).map(([k, v]) => itemValueToRow(k, v)), "id");
  await up("deadlines", Object.entries(c.deadlines || {}).map(([k, v]) => deadlineValueToRow(k, v)), "id");
  await up("actions", Object.entries(c.activity || {}).map(([k, v]) => actionValueToRow(k, v)), "id");
  if (c.week) {
    const { error } = await db.from("weekly_summaries").insert(weekValueToRow(c.week));
    if (error) throw new Error(`weekly_summaries: ${error.message}`);
    console.log("weekly_summaries: 1");
  }
  const { error } = await db.from("site_meta").update({ reviewed: c.reviewed ?? null, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw new Error(`site_meta: ${error.message}`);
  console.log(`Done. Reviewed date: ${c.reviewed}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
