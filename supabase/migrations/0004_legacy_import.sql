-- Carry the pilot tracker's existing data into the app without re-entry.
-- scripts/import-tracker.ts turns the tracker's "Export all data" file into one SQL transaction that fills these
-- columns and tables. Every imported row keeps its original document in `legacy` so nothing is lost even where
-- the app's schema has no matching column yet. See docs/IMPORT.md.

-- Fields the live tracker has that 0003 didn't model.
alter table public.tasks
  add column assignee_email text,
  add column outlook        jsonb,                -- {date, count, due}: Outlook reminders were added from the pilot
  add column legacy_id      text unique,
  add column legacy         jsonb;

alter table public.team_tasks
  add column owner_email           text,
  add column owner_legacy          text,          -- pilot user id, resolved through legacy_people
  add column collaborators_legacy  text[] not null default '{}',
  add column created_by_legacy     text,
  add column legacy_id             text unique,
  add column legacy                jsonb;

alter table public.companies
  add column legacy_id text unique,
  add column legacy    jsonb;

alter table public.client_tasks
  add column legacy_id text unique,
  add column legacy    jsonb;

alter table public.task_plans
  add column legacy jsonb;

-- The client's project manager is stored on each pilot client as a name and email; keep it as a contact
-- until that person has a login, then set companies.pm_id.
alter table public.contacts drop constraint contacts_kind_check;
alter table public.contacts add constraint contacts_kind_check check (kind in ('compliance','plant_manager','pm','other'));

-- CGM people the pilot refers to by its own user ids (team task owners, collaborators, activity authors).
create table public.legacy_people (
  legacy_id   text primary key,
  name        text not null default '',
  profile_id  uuid references public.profiles on delete set null,
  linked_at   timestamptz
);

-- Pilot activity history and the saved copies of deleted records ("Restore" in the pilot).
alter table public.activity_log
  add column source text not null default 'app' check (source in ('app','legacy')),
  add column legacy jsonb;

create table public.legacy_snapshots (
  entry_id  text primary key,
  day       date,
  snap      jsonb not null
);

alter table public.legacy_people    enable row level security;
alter table public.legacy_snapshots enable row level security;
create policy "legacy people staff read"  on public.legacy_people    for select using (public.is_staff());
create policy "legacy people admin write" on public.legacy_people    for all using (public.staff_role() = 'admin') with check (public.staff_role() = 'admin');
create policy "legacy snapshots staff"    on public.legacy_snapshots for select using (public.is_staff());

-- Import mode: while app.importing = 'on' (set by the import transaction), triggers don't log or police rows.
create or replace function public.importing() returns boolean
language sql stable as $$ select coalesce(current_setting('app.importing', true), '') = 'on' $$;

create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text := tg_argv[0];
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  act text;
begin
  if public.importing() then return null; end if;
  if tg_op = 'INSERT' then act := 'created'; elsif tg_op = 'DELETE' then act := 'deleted'; else act := 'updated'; end if;
  if tg_op = 'UPDATE' and k = 'task' then
    if n->>'status' = 'review' and o->>'status' <> 'review' then act := 'performed';
    elsif n->>'status' = 'done' and o->>'status' = 'review' then act := 'approved';
    elsif n->>'status' = 'done' and o->>'status' <> 'done' then act := 'completed';
    elsif n->>'status' = 'open' and o->>'status' = 'review' then act := 'sent_back';
    end if;
  end if;
  if tg_op = 'UPDATE' and o = n then return null; end if;
  insert into activity_log (actor_id, action, kind, target_id, company_id, label, old_row, new_row)
  values (auth.uid(), act, k, coalesce(r->>'id', r->>'code', r->>'company_id'),
          case when k = 'client' then (r->>'id')::uuid else (r->>'company_id')::uuid end,
          coalesce(r->>'title', r->>'name', r->>'code', r->>'product'), o, n);
  return null;
end $$;

create or replace function public.spawn_next_occurrence() returns trigger
language plpgsql security definer set search_path = public as $$
declare base date; nid uuid;
begin
  if public.importing() then return new; end if;   -- imported chains already carry prev/next links
  if new.status in ('review','done') and old.status not in ('review','done')
     and new.recur_n > 0 and new.next_id is null then
    base := case when new.recur_basis = 'done' then coalesce(new.completed_at, current_date) else new.due_date end;
    if base is null then return new; end if;
    insert into tasks (company_id, title, facility, standard_code, requirement, due_date, assignee_text, assignee_id, assignee_email,
                       remind_days, recur_n, recur_unit, recur_basis, status, notes, created_by, prev_id, plan_id)
    values (new.company_id, new.title, new.facility, new.standard_code, new.requirement,
            public.next_due(base, new.recur_n, new.recur_unit), new.assignee_text, new.assignee_id, new.assignee_email,
            new.remind_days, new.recur_n, new.recur_unit, new.recur_basis, 'open', null, auth.uid(), new.id, new.plan_id)
    returning id into nid;
    new.next_id := nid;
  end if;
  return new;
end $$;

-- Client users may not change the imported/legacy fields either.
create or replace function public.guard_task_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.importing() then return new; end if;

  if new.status = 'done' and old.status <> 'done' and not public.can_approve() then
    raise exception 'Only a CGM project manager or admin can approve and close a task' using errcode = '42501';
  end if;

  if not public.is_staff() then
    if (new.company_id, new.title, new.facility, new.standard_code, new.requirement, new.due_date, new.assignee_text,
        new.assignee_id, new.assignee_email, new.remind_days, new.recur_n, new.recur_unit, new.recur_basis, new.reviewed_at,
        new.reviewed_by, new.prev_id, new.next_id, new.copied_from, new.plan_id, new.sample, new.created_at, new.created_by,
        new.outlook, new.legacy_id, new.legacy)
       is distinct from
       (old.company_id, old.title, old.facility, old.standard_code, old.requirement, old.due_date, old.assignee_text,
        old.assignee_id, old.assignee_email, old.remind_days, old.recur_n, old.recur_unit, old.recur_basis, old.reviewed_at,
        old.reviewed_by, old.prev_id, old.next_id, old.copied_from, old.plan_id, old.sample, old.created_at, old.created_by,
        old.outlook, old.legacy_id, old.legacy) then
      raise exception 'Client users can only mark a task performed, post evidence and add notes' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and not (old.status in ('open','inprogress') and new.status in ('inprogress','review')) then
      raise exception 'Client users can only move a task to in progress or performed' using errcode = '42501';
    end if;
    if new.status = 'review' and old.status <> 'review' then
      new.performed_by := auth.uid();
      new.completed_at := coalesce(new.completed_at, current_date);
    elsif new.performed_by is distinct from old.performed_by or new.completed_at is distinct from old.completed_at then
      raise exception 'Performed details are set when the task is marked performed' using errcode = '42501';
    end if;
  else
    if new.status = 'review' and old.status <> 'review' then
      new.performed_by := coalesce(new.performed_by, auth.uid());
      new.completed_at := coalesce(new.completed_at, current_date);
    end if;
    if new.status = 'done' and old.status <> 'done' then
      new.reviewed_by := auth.uid();
      new.reviewed_at := current_date;
      new.completed_at := coalesce(new.completed_at, current_date);
    end if;
    if new.status = 'open' and old.status = 'review' then
      new.performed_by := null; new.completed_at := null;
    end if;
  end if;
  return new;
end $$;

-- Link a pilot person to a real login once they've signed in to the app (CGM admin, after import).
create or replace function public.link_legacy_person(p_legacy_id text, p_profile uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.staff_role() is distinct from 'admin' and auth.uid() is not null then
    raise exception 'Only a CGM admin can link people' using errcode = '42501';
  end if;
  update legacy_people set profile_id = p_profile, linked_at = now() where legacy_id = p_legacy_id;
  update team_tasks set owner_id = p_profile where owner_legacy = p_legacy_id and owner_id is null;
  update team_tasks set collaborators = array(select distinct unnest(collaborators || p_profile))
   where p_legacy_id = any (collaborators_legacy) and not (p_profile = any (collaborators));
end $$;
