// Fresh in-memory Postgres with every migration applied, plus minimal stand-ins for the parts of
// Supabase the migrations rely on (auth.users, auth.uid(), roles, storage.buckets/objects).
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role authenticated; create role anon;
    create schema storage;
    create table storage.buckets(id text primary key, name text not null, public boolean default false);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text not null, owner uuid default auth.uid());
    alter table storage.objects enable row level security;
  `);
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(new URL(f, dir), "utf8"));
  }
  await db.exec(`
    grant usage on schema public, storage to authenticated;
    grant all on all tables in schema public, storage to authenticated;
    grant all on all sequences in schema public to authenticated;
  `);
  return db;
}
