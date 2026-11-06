/* Development seed: fake users for every role in docs/ACCESS.md, three fake companies and fake tasks.
   Usage: npm run seed:dev   (after `npm run db:start` and `npm run db:env`)
   Refuses to run against anything but a local Supabase. Safe to re-run: it updates what already exists.
   Everything here is invented. Never put real client names, people or tasks in this file. */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { libraryRows } from "./import-library";

type Person = {
  email: string;
  name: string;
  staff_role?: "admin" | "pm" | "staff";
  company?: string;
  company_role?: "admin" | "member";
  functions?: string[];
};

// One fake company per product mix the access matrix cares about.
export const COMPANIES = [
  { key: "watch", name: "Example Watch Co (fake)", region: "WECC", functions: ["GO", "GOP"], products: ["watch"] },
  { key: "full", name: "Sample Peaker LLC (fake)", region: "SERC", functions: ["GO", "GOP"], products: ["tracker", "client_tasks"] },
  { key: "tracker", name: "Demo Wind Farm LLC (fake)", region: "MRO", functions: ["GO", "GOP", "GO-2", "GOP-2"], products: ["tracker"] },
] as const;

export const PEOPLE: Person[] = [
  { email: "admin@cgm.example", name: "Alex Admin", staff_role: "admin" },
  { email: "pm@cgm.example", name: "Pat Manager", staff_role: "pm" },
  { email: "staff@cgm.example", name: "Sam Staff", staff_role: "staff" },
  { email: "admin@watch.example", name: "Wendy Watch", company: "watch", company_role: "admin", functions: ["GO", "GOP"] },
  { email: "admin@peaker.example", name: "Paul Peaker", company: "full", company_role: "admin", functions: ["GO", "GOP"] },
  { email: "member@peaker.example", name: "Mia Member", company: "full", company_role: "member", functions: ["GO", "GOP"] },
  { email: "member@wind.example", name: "Will Wind", company: "tracker", company_role: "member", functions: ["GO", "GOP"] },
  { email: "noplan@nowhere.example", name: "Nora Noplan" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (n: number) => iso(new Date(Date.now() + n * 86400000));

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function ensureUser(db: SupabaseClient, email: string): Promise<string> {
  const list = await db.auth.admin.listUsers({ perPage: 1000 });
  const found = list.data?.users.find((u) => u.email === email);
  if (found) return found.id;
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`create ${email}: ${error?.message}`);
  return data.user.id;
}

async function main() {
  config({ path: ".env.local" });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error(`seed:dev only runs against a local Supabase. NEXT_PUBLIC_SUPABASE_URL is "${url}".`);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Library (CGM reference content, not client data)
  const { std, tpl } = libraryRows(JSON.parse(readFileSync("data/tracker-standards-library.json", "utf8")).standards);
  await must(db.from("library_standards").upsert(std, { onConflict: "code" }), "library_standards");
  await must(db.from("obligation_templates").delete().in("standard_code", std.map((s) => s.code)), "templates delete");
  await must(db.from("obligation_templates").insert(tpl), "obligation_templates");

  // Companies and products
  const companyIds: Record<string, string> = {};
  for (const c of COMPANIES) {
    const existing = await must(db.from("companies").select("id").eq("name", c.name).maybeSingle(), "companies");
    const row = { name: c.name, region: c.region, functions: [...c.functions] };
    const saved = existing
      ? await must(db.from("companies").update(row).eq("id", (existing as { id: string }).id).select("id").single(), "company update")
      : await must(db.from("companies").insert(row).select("id").single(), "company insert");
    companyIds[c.key] = (saved as { id: string }).id;
    for (const product of c.products) {
      await must(
        db.from("entitlements").upsert(
          { company_id: companyIds[c.key], product, status: "active", source: product === "watch" ? "comp" : "contract", notes: "dev seed" },
          { onConflict: "company_id,product" },
        ),
        "entitlements",
      );
    }
  }

  // People
  const ids: Record<string, string> = {};
  for (const p of PEOPLE) {
    const id = await ensureUser(db, p.email);
    ids[p.email] = id;
    await must(
      db.from("profiles").update({
        full_name: p.name,
        staff_role: p.staff_role ?? null,
        role: p.staff_role === "admin" ? "editor" : "subscriber",
        company_id: p.company ? companyIds[p.company] : null,
        company_role: p.company_role ?? "member",
        functions: p.functions ?? [],
        onboarded_at: new Date().toISOString(),
      }).eq("id", id),
      `profile ${p.email}`,
    );
  }
  for (const k of ["full", "tracker"]) {
    await must(db.from("companies").update({ pm_id: ids["pm@cgm.example"] }).eq("id", companyIds[k]), "pm");
  }

  // Fake tasks for the two Tracker companies, from the first few recurring templates (only when none exist yet)
  const recurring = tpl.filter((t) => t.recur_n > 0).slice(0, 8);
  const offsets = [-20, -3, 5, 12, 25, 45, 90, 200];
  for (const k of ["full", "tracker"]) {
    const { count } = await db.from("tasks").select("id", { count: "exact", head: true }).eq("company_id", companyIds[k]);
    if (count) continue;
    const rows = recurring.map((t, i) => ({
      company_id: companyIds[k],
      title: t.title,
      standard_code: t.standard_code,
      requirement: t.req || null,
      due_date: addDays(offsets[i]),
      facility: k === "full" ? "Unit 1 (fake)" : "Wind Site A (fake)",
      assignee_text: i % 2 ? "Sam Staff" : "Pat Manager",
      recur_n: t.recur_n,
      recur_unit: t.recur_unit,
      recur_basis: t.recur_basis,
      status: i === 2 ? "review" : i === 3 ? "inprogress" : "open",
      completed_at: i === 2 ? addDays(-1) : null,
    }));
    await must(db.from("tasks").insert(rows), `tasks ${k}`);
  }

  // Client Tasks for the add-on company
  const { count: ct } = await db.from("client_tasks").select("id", { count: "exact", head: true }).eq("company_id", companyIds.full);
  if (!ct) {
    await must(
      db.from("client_tasks").insert([
        { company_id: companyIds.full, title: "Renew fake air permit", due_date: addDays(40), category: "Environmental", recur_n: 0, recur_unit: "m" },
        { company_id: companyIds.full, title: "Quarterly safety walk (fake)", due_date: addDays(10), recur_n: 3, recur_unit: "m" },
      ]),
      "client_tasks",
    );
  }

  // Team task and a client channel
  const { count: tt } = await db.from("team_tasks").select("id", { count: "exact", head: true });
  if (!tt) {
    await must(
      db.from("team_tasks").insert({ title: "Draft fake internal procedure", owner_id: ids["staff@cgm.example"], planned_date: addDays(14) }),
      "team_tasks",
    );
  }
  for (const k of ["full", "tracker"]) {
    const { count: ch } = await db.from("chats").select("id", { count: "exact", head: true }).eq("company_id", companyIds[k]);
    if (!ch) await must(db.from("chats").insert({ type: "client", company_id: companyIds[k] }), "chats");
  }

  console.log("Dev seed done. Sign in at http://localhost:3000/login as any of:");
  for (const p of PEOPLE) console.log(`  ${p.email.padEnd(26)} ${p.staff_role ? `CGM ${p.staff_role}` : p.company ? `client ${p.company_role} (${p.company})` : "no plan"}`);
  console.log("Sign-in emails arrive at http://127.0.0.1:54324 (local mail catcher).");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
