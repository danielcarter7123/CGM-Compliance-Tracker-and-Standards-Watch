-- CGM Standards Watch: initial schema
-- Run in Supabase: SQL Editor > New query > paste > Run (or `supabase db push` with the CLI).

-- gen_random_uuid() is built into Postgres 13+, which Supabase runs.

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  stripe_customer_id  text unique,
  plan                text not null default 'watch',
  status              text not null default 'none'
                      check (status in ('none','trialing','active','past_due','canceled')),
  seats               int not null default 5,
  current_period_end  timestamptz,
  created_at          timestamptz not null default now()
);

create table public.profiles (
  id              uuid primary key references auth.users on delete cascade,
  email           text,
  full_name       text,
  company_id      uuid references public.companies on delete set null,
  role            text not null default 'subscriber' check (role in ('subscriber','editor')),
  functions       text[] not null default '{}',
  region          text,
  digest_opt_in   boolean not null default true,
  calendar_token  uuid not null default gen_random_uuid() unique,
  created_at      timestamptz not null default now()
);

-- A profile row is created for every new login.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Published content (what subscribers read)
-- Field names follow the pilot so drafts from the Monday task map 1:1.
-- ---------------------------------------------------------------------------
create table public.sources (
  key    text primary key,
  title  text not null,
  url    text
);

create table public.standards (
  id          text primary key,            -- slug of std, e.g. 'eop-004-5'
  std         text not null,               -- 'EOP-004-5'
  title       text not null,
  functions   text[] not null default '{}',-- GO, GOP, TO, TOP, TP, PC
  topic       text not null check (topic in ('ibr','cip','model','ops','load')),
  effective   date,                        -- U.S. effective date; null while in development
  ferc        text,                        -- 'YYYY-MM-DD' or 'YYYY-MM'
  order_no    text,
  status      text check (status in ('dev')),
  stage       text,
  phasing     boolean not null default false,
  milestones  jsonb not null default '[]', -- [{d, l}]
  what        text,
  todo        text,
  todo_tx     text,
  news        jsonb not null default '[]', -- [{d, t}]
  src         text[] not null default '{}',
  pos         int,
  updated_at  timestamptz not null default now()
);

create table public.deadlines (
  id         text primary key,
  d          date not null,
  title      text not null,
  who        text,
  functions  text[]                        -- null = everyone
);

create table public.actions (
  id    text primary key,
  d     text not null,                     -- 'YYYY-MM-DD' or 'YYYY-MM'
  src   text not null check (src in ('FERC','NERC')),
  text  text not null,
  pos   int
);

create table public.weekly_summaries (
  id              uuid primary key default gen_random_uuid(),
  label           text not null,
  covers          text,
  items           jsonb not null default '[]', -- [{b, t}]
  published_at    timestamptz not null default now(),
  digest_sent_at  timestamptz
);

create table public.site_meta (
  id          int primary key default 1 check (id = 1),
  reviewed    date,
  updated_at  timestamptz not null default now()
);
insert into public.site_meta (id) values (1);

-- ---------------------------------------------------------------------------
-- Review queue
-- ---------------------------------------------------------------------------
create table public.drafts (
  id          text primary key,
  section     text not null check (section in ('items','deadlines','activity','sources','week')),
  op          text not null check (op in ('upsert','remove')),
  key         text not null,
  label       text,
  reason      text,
  refs        jsonb not null default '[]',
  value       jsonb,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  edited      boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  text,
  decided_at  timestamptz,
  decided_by  uuid references auth.users
);
create index drafts_status_idx on public.drafts (status, created_at);

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'editor')
$$;

create or replace function public.has_access() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_editor() or exists (
    select 1 from profiles p join companies c on c.id = p.company_id
    where p.id = auth.uid() and c.status in ('active','trialing')
  )
$$;

-- Subscribers can change their own preferences, never their role or company.
create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_editor() then
    new.role := old.role;
    new.company_id := old.company_id;
    new.calendar_token := old.calendar_token;
  end if;
  return new;
end $$;

create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.companies        enable row level security;
alter table public.profiles         enable row level security;
alter table public.sources          enable row level security;
alter table public.standards        enable row level security;
alter table public.deadlines        enable row level security;
alter table public.actions          enable row level security;
alter table public.weekly_summaries enable row level security;
alter table public.site_meta        enable row level security;
alter table public.drafts           enable row level security;

create policy "own or editor reads profile" on public.profiles
  for select using (id = auth.uid() or public.is_editor());
create policy "own profile update" on public.profiles
  for update using (id = auth.uid() or public.is_editor());

create policy "members read own company" on public.companies
  for select using (
    public.is_editor() or id = (select company_id from public.profiles where id = auth.uid())
  );

-- Published content: subscribers with an active plan and editors read; only editors write.
do $$
declare t text;
begin
  foreach t in array array['sources','standards','deadlines','actions','weekly_summaries','site_meta'] loop
    execute format('create policy "subscribers read" on public.%I for select using (public.has_access())', t);
    execute format('create policy "editors write" on public.%I for all using (public.is_editor()) with check (public.is_editor())', t);
  end loop;
end $$;

-- Drafts: editors only.
create policy "editors manage drafts" on public.drafts
  for all using (public.is_editor()) with check (public.is_editor());

-- After you first sign in, make yourself an editor (replace the email):
--   update public.profiles set role = 'editor' where email = 'dan@cgmconsultinggroup.com';
