/* One-time import of CGM's tracker standards library (standards + recurring obligation templates).
   Usage: npm run import:library            (reads data/tracker-standards-library.json)
   Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local. Safe to re-run: standards are upserted
   and each standard's templates are replaced. Repeat-from bases come in unconfirmed (basis_confirmed = false). */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

type Tpl = { req?: string; title: string; recur?: { n?: number; unit?: string; basis?: string }; suggestedBasis?: string };
type Std = { code: string; version: string; title: string; family?: string; applies?: string[]; url?: string; notes?: string; templates?: Tpl[] };

export function libraryRows(standards: Std[]) {
  const std = standards.map((s) => ({
    code: s.code,
    version: s.version,
    title: s.title,
    family: s.family || s.code.split("-")[0],
    applies: s.applies || [],
    url: s.url && /^https:\/\//.test(s.url) ? s.url : null,
    notes: s.notes || null,
  }));
  const tpl = standards.flatMap((s) =>
    (s.templates || []).map((t, i) => ({
      standard_code: s.code,
      req: t.req || "",
      title: t.title,
      recur_n: t.recur?.n ?? 0,
      recur_unit: t.recur?.unit || "m",
      recur_basis: t.recur?.basis || t.suggestedBasis || "due",
      basis_confirmed: !!t.recur?.basis,
      pos: i,
    })),
  );
  return { std, tpl };
}

async function main() {
  config({ path: ".env.local" });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const file = process.argv[2] || "data/tracker-standards-library.json";
  const { std, tpl } = libraryRows(JSON.parse(readFileSync(file, "utf8")).standards);

  let r = await db.from("library_standards").upsert(std, { onConflict: "code" });
  if (r.error) throw new Error(`library_standards: ${r.error.message}`);
  r = await db.from("obligation_templates").delete().in("standard_code", std.map((s) => s.code));
  if (r.error) throw new Error(`obligation_templates delete: ${r.error.message}`);
  r = await db.from("obligation_templates").insert(tpl);
  if (r.error) throw new Error(`obligation_templates: ${r.error.message}`);
  console.log(`library_standards: ${std.length}, obligation_templates: ${tpl.length}`);
}

if (process.argv[1]?.endsWith("import-library.ts")) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
