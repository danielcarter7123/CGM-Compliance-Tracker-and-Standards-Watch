-- W2 accounts: first-login onboarding, company invites and seat limits.
--
-- - profiles.onboarded_at: set when a client user finishes the welcome screen (functions, Regional Entity).
-- - invites: a company admin (or a CGM admin or PM) invites a colleague by email. The invitee signs in with
--   that address and accept_invite() puts them in the company. Invites last 14 days and can be revoked.
-- - Seats: companies.seats caps client users. Members plus open invites can't exceed it; the database refuses.
-- - Company admins may remove a colleague from their company (not themselves) with remove_member().

-- ---------------------------------------------------------------------------
-- Profiles: onboarding and Regional Entity
-- ---------------------------------------------------------------------------
alter table public.profiles add column onboarded_at timestamptz;
update public.profiles set onboarded_at = created_at;  -- nobody already using the app is sent back through it
alter table public.profiles
  add constraint profiles_region_check check (region is null or region in ('MRO','NPCC','RF','SERC','Texas RE','WECC'));
alter table public.companies
  add constraint companies_seats_check check (seats between 1 and 500);

comment on column public.profiles.onboarded_at is 'When the user finished the first-login welcome screen. Null = show it.';
comment on column public.companies.seats is 'Most client users this company may have (members plus open invites). CGM admins change it.';

-- ---------------------------------------------------------------------------
-- Trusted changes: functions below that must move someone between companies set this flag for the
-- current transaction. It can't be set through the API (only functions in public are exposed).
-- ---------------------------------------------------------------------------
create or replace function public.trusted_change() returns boolean
language sql stable as $$ select coalesce(current_setting('cgm.trusted', true), '') = 'on' $$;

-- Replaces 0002's version: same rules, plus the trusted flag.
create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me_staff text := public.staff_role();
  me_company uuid := public.my_company();
  me_company_admin boolean := public.is_company_admin();
  cr text;
begin
  if auth.uid() is null or me_staff = 'admin' or public.trusted_change() then
    return new;  -- service role, migrations, CGM admins, trusted functions
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

-- A company admin (or a CGM admin or PM) removes someone from the company. They keep their login
-- but lose the company's products at once. Nobody removes themselves this way.
create or replace function public.remove_member(member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select company_id into cid from profiles where id = member and staff_role is null;
  if cid is null or member = auth.uid() or not public.can_manage_company(cid) then
    raise exception 'You can''t remove that person.' using errcode = 'P0001';
  end if;
  perform set_config('cgm.trusted', 'on', true);
  update profiles set company_id = null, company_role = 'member' where id = member;
  perform set_config('cgm.trusted', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------
create table public.invites (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies on delete cascade,
  email         text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  company_role  text not null default 'member' check (company_role in ('member','admin')),
  invited_by    uuid references public.profiles on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '14 days',
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles on delete set null,
  revoked_at    timestamptz
);
create unique index invites_open_idx on public.invites (company_id, email) where accepted_at is null and revoked_at is null;
create index invites_email_idx on public.invites (email) where accepted_at is null and revoked_at is null;

-- May the signed-in user manage this company's people? Its company admins, and CGM admins and PMs.
create or replace function public.can_manage_company(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role() in ('admin','pm'), false)
      or (cid is not null and cid = public.my_company() and public.is_company_admin())
$$;

-- Client users plus open (unexpired) invites.
create or replace function public.seats_used(cid uuid) returns int
language sql stable security definer set search_path = public as $$
  select (select count(*) from profiles where company_id = cid and staff_role is null)::int
       + (select count(*) from invites where company_id = cid and accepted_at is null and revoked_at is null and expires_at > now())::int
$$;

create or replace function public.check_invite() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap int; cname text;
begin
  new.email := lower(trim(new.email));
  new.invited_by := auth.uid();
  new.created_at := now();
  new.expires_at := now() + interval '14 days';
  new.accepted_at := null; new.accepted_by := null; new.revoked_at := null;
  if exists (select 1 from profiles where company_id = new.company_id and lower(email) = new.email) then
    raise exception '% is already on this team.', new.email using errcode = 'P0001';
  end if;
  -- An expired invite to the same address doesn't block a new one.
  update invites set revoked_at = now()
   where company_id = new.company_id and email = new.email and accepted_at is null and revoked_at is null and expires_at <= now();
  select seats, name into cap, cname from companies where id = new.company_id;
  if public.seats_used(new.company_id) >= cap then
    raise exception 'All % seats at % are in use. Remove someone or revoke an invite, or ask CGM for more seats.', cap, cname using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger invites_check before insert on public.invites for each row execute function public.check_invite();

alter table public.invites enable row level security;
create policy "invites read" on public.invites for select using (
  public.is_staff() or (company_id = public.my_company() and public.is_company_admin())
);
create policy "invites create" on public.invites for insert with check (public.can_manage_company(company_id));
-- No update or delete policies: revoke_invite() and accept_invite() are the only ways to change an invite.

create or replace function public.revoke_invite(invite_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select company_id into cid from invites where id = invite_id and accepted_at is null and revoked_at is null;
  if cid is null or not public.can_manage_company(cid) then
    raise exception 'That invite is not open, or you can''t manage it.' using errcode = 'P0001';
  end if;
  update invites set revoked_at = now() where id = invite_id;
end $$;

-- Called after sign-in. If an open invite matches the signed-in address and the user has no company yet,
-- joins that company. Returns the company name, or null when there is nothing to accept.
create or replace function public.accept_invite() returns text
language plpgsql security definer set search_path = public as $$
declare
  me profiles;
  addr text;
  inv invites;
  cap int;
  cname text;
  cfns text[];
begin
  if auth.uid() is null then return null; end if;
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.company_id is not null or me.staff_role is not null then return null; end if;
  select lower(u.email) into addr from auth.users u where u.id = auth.uid();
  select * into inv from invites
   where email = addr and accepted_at is null and revoked_at is null and expires_at > now()
   order by created_at desc limit 1 for update;
  if inv.id is null then return null; end if;
  select seats, name, functions into cap, cname, cfns from companies where id = inv.company_id;
  -- The invite already holds a seat; this only catches people added another way since.
  if (select count(*) from profiles where company_id = inv.company_id and staff_role is null) >= cap then
    raise exception 'All % seats at % are in use. Ask your company admin to free one.', cap, cname using errcode = 'P0001';
  end if;
  perform set_config('cgm.trusted', 'on', true);
  update profiles
     set company_id = inv.company_id,
         company_role = inv.company_role,
         functions = case when functions = '{}' then coalesce(cfns, '{}') else functions end
   where id = auth.uid();
  perform set_config('cgm.trusted', '', true);
  update invites set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return cname;
end $$;

revoke execute on function public.accept_invite() from anon;
revoke execute on function public.revoke_invite(uuid) from anon;
revoke execute on function public.remove_member(uuid) from anon;
