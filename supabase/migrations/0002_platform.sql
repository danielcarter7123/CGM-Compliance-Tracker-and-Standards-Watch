-- CGM Compliance Platform: one app, two products.
-- Adds staff roles, per-company product entitlements (Standards Watch, Compliance Tracker, Client Tasks add-on),
-- tracker client fields on companies, and client contacts. Replaces the access helpers from 0001.
--
-- Access in one sentence: CGM staff see every client; a client's users see only their own company's data,
-- and only for the products their company is entitled to.

-- ---------------------------------------------------------------------------
-- People: CGM staff roles and client company roles
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column staff_role   text check (staff_role in ('admin','pm','staff')),   -- null = not CGM staff
  add column company_role text not null default 'member' check (company_role in ('member','admin'));

comment on column public.profiles.role is 'Legacy from 0001. editor = may review Standards Watch drafts. Prefer staff_role.';
comment on column public.profiles.staff_role is 'CGM staff: admin (everything, incl. Watch review), pm (approves performed tasks), staff (works all clients). Null for client users.';
comment on column public.profiles.company_role is 'For client users: admin can see their company''s users and billing; member cannot.';

-- ---------------------------------------------------------------------------
-- Companies double as tracker clients
-- ---------------------------------------------------------------------------
alter table public.companies
  add column ncr_id         text,
  add column region         text check (region in ('MRO','NPCC','RF','SERC','Texas RE','WECC')),
  add column reg_date       date,
  add column functions      text[] not null default '{}',
  add column entities       jsonb not null default '{}',  -- {rc, ba, top, tp, pc, to, tsp, go, gop}: free text "Entity name / NCR ID"
  add column facilities     text,
  add column sharepoint_url text check (sharepoint_url is null or sharepoint_url ~ '^https://'),
  add column notes          text,
  add column pm_id          uuid references public.profiles on delete set null,  -- CGM project manager
  add column sample         boolean not null default false;

comment on column public.companies.status is 'Legacy from 0001; use entitlements.';
comment on column public.companies.plan   is 'Legacy from 0001; use entitlements.';

-- People at a client who receive digests but may not have a login.
create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies on delete cascade,
  kind        text not null check (kind in ('compliance','plant_manager','other')),
  name        text not null,
  email       text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  digest      boolean not null default true,
  user_id     uuid references public.profiles on delete set null,
  created_at  timestamptz not null default now()
);
create index contacts_company_idx on public.contacts (company_id);

-- ---------------------------------------------------------------------------
-- Entitlements: what each company has bought
-- ---------------------------------------------------------------------------
create table public.entitlements (
  company_id              uuid not null references public.companies on delete cascade,
  product                 text not null check (product in ('watch','tracker','client_tasks')),
  status                  text not null default 'active' check (status in ('trialing','active','past_due','canceled')),
  source                  text not null default 'contract' check (source in ('stripe','contract','comp')),
  stripe_subscription_id  text,
  current_period_end      timestamptz,
  notes                   text,
  updated_at              timestamptz not null default now(),
  primary key (company_id, product)
);

-- Carry over Watch subscriptions created under 0001.
insert into public.entitlements (company_id, product, status, source, current_period_end)
select id, 'watch', status, case when stripe_customer_id is null then 'contract' else 'stripe' end, current_period_end
from public.companies where status in ('trialing','active','past_due','canceled');

-- ---------------------------------------------------------------------------
-- Access helpers (security definer so policies can call them without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid()
$$;

create or replace function public.staff_role() returns text
language sql stable security definer set search_path = public as $$
  select staff_role from profiles where id = auth.uid()
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role() is not null, false)
$$;

create or replace function public.can_approve() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role() in ('admin','pm'), false)
$$;

create or replace function public.is_company_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select company_role = 'admin' from profiles where id = auth.uid()), false)
$$;

-- Standards Watch reviewers: CGM admins, plus anyone still flagged with the legacy editor role.
create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and (staff_role = 'admin' or role = 'editor'))
$$;

-- Does a company hold a live entitlement? The Tracker includes Standards Watch;
-- the Client Tasks add-on only counts while the Tracker is also live.
create or replace function public.company_has(cid uuid, p text) returns boolean
language sql stable security definer set search_path = public as $$
  select cid is not null and case p
    when 'watch' then exists (select 1 from entitlements e where e.company_id = cid and e.product in ('watch','tracker') and e.status in ('active','trialing'))
    when 'client_tasks' then
      exists (select 1 from entitlements e where e.company_id = cid and e.product = 'client_tasks' and e.status in ('active','trialing'))
      and exists (select 1 from entitlements e where e.company_id = cid and e.product = 'tracker' and e.status in ('active','trialing'))
    else exists (select 1 from entitlements e where e.company_id = cid and e.product = p and e.status in ('active','trialing'))
  end
$$;

-- The signed-in user's own company holds product p (staff always pass).
create or replace function public.has_product(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or public.company_has(public.my_company(), p)
$$;

-- Standards Watch content access (used by the 0001 policies).
create or replace function public.has_access() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_editor() or public.has_product('watch')
$$;

-- A client user may see this company's tracker data.
create or replace function public.client_can(cid uuid, p text) returns boolean
language sql stable security definer set search_path = public as $$
  select cid = public.my_company() and public.company_has(cid, p)
$$;

-- ---------------------------------------------------------------------------
-- Profile protection: only CGM admins change roles or company membership.
-- Company admins may change company_role for people in their own company.
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me_staff text := public.staff_role();
  me_company uuid := public.my_company();
  me_company_admin boolean := public.is_company_admin();
  cr text;
begin
  if auth.uid() is null or me_staff = 'admin' then
    return new;  -- service role, migrations, CGM admins
  end if;
  if old.id <> auth.uid() then
    -- Someone else's profile: a company admin may only change company_role, within their own company.
    if me_company_admin and old.company_id = me_company then
      cr := new.company_role;
      new := old;
      new.company_role := cr;
      return new;
    end if;
    return old;
  end if;
  new.role := old.role;
  new.staff_role := old.staff_role;
  new.company_id := old.company_id;
  new.company_role := old.company_role;
  new.calendar_token := old.calendar_token;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security for the new and changed tables
-- ---------------------------------------------------------------------------
alter table public.contacts     enable row level security;
alter table public.entitlements enable row level security;

drop policy "own or editor reads profile" on public.profiles;
drop policy "own profile update" on public.profiles;
create policy "profiles read" on public.profiles for select using (
  id = auth.uid() or public.is_staff()
  or (company_id = public.my_company() and public.is_company_admin())
);
create policy "profiles update" on public.profiles for update using (
  id = auth.uid() or public.staff_role() = 'admin'
  or (company_id = public.my_company() and public.is_company_admin())
);

drop policy "members read own company" on public.companies;
create policy "companies read" on public.companies for select using (public.is_staff() or id = public.my_company());
create policy "companies write" on public.companies for insert with check (public.staff_role() in ('admin','pm'));
create policy "companies update" on public.companies for update using (public.staff_role() in ('admin','pm')) with check (public.staff_role() in ('admin','pm'));
create policy "companies delete" on public.companies for delete using (public.staff_role() = 'admin');

create policy "contacts read" on public.contacts for select using (
  public.is_staff() or (company_id = public.my_company() and public.is_company_admin())
);
create policy "contacts write" on public.contacts for all using (public.is_staff()) with check (public.is_staff());

create policy "entitlements read" on public.entitlements for select using (public.is_staff() or company_id = public.my_company());
create policy "entitlements write" on public.entitlements for all using (public.staff_role() = 'admin') with check (public.staff_role() = 'admin');
