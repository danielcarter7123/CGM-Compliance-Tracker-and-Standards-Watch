/* Writes the local Supabase URL and keys into .env.local (npm run db:env), keeping every other line.
   Run after `npm run db:start`. Local keys are the CLI's fixed development keys; they never work against the cloud. */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const out = execSync("npx supabase status -o env", { encoding: "utf8" });
const status: Record<string, string> = {};
for (const line of out.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m) status[m[1]] = m[2];
}
const anon = status.ANON_KEY || status.PUBLISHABLE_KEY;
const service = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
if (!status.API_URL || !anon || !service) throw new Error("Couldn't read `supabase status`. Is the local database running (npm run db:start)?");

const values: Record<string, string> = {
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
  SUPABASE_SERVICE_ROLE_KEY: service,
  SUPABASE_DB_URL: status.DB_URL || "",
};

const file = ".env.local";
const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : readFileSync(".env.example", "utf8").split(/\r?\n/);
const seen = new Set<string>();
const next = lines.map((line) => {
  const k = line.match(/^([A-Z_]+)=/)?.[1];
  if (k && k in values) {
    seen.add(k);
    return `${k}=${values[k]}`;
  }
  return line;
});
for (const [k, v] of Object.entries(values)) if (!seen.has(k)) next.push(`${k}=${v}`);
writeFileSync(file, next.join("\n"));
console.log(`.env.local now points at the local database (${status.API_URL}).`);
