-- Compliance Tracker tables, rules and audit log.
-- Mirrors the pilot tracker (docs/tracker/TRACKER-SPEC.md, DATA-SHAPES.md) with real per-client isolation.
--
-- Who can do what (see docs/ACCESS.md for the full matrix):
--   CGM staff      read and write every client's tracker data.
--   CGM pm/admin   additionally approve performed tasks ("Approve & close").
--   Client users   read their own company's tasks when the company has the Tracker; may mark a task performed,
--                  post the evidence link and add notes; nothing else on a task.
--                  Client Tasks add-on: read and write their own company's client tasks.
--   Everyone else  nothing.

-- ---------------------------------------------------------------------------
-- Reference library (CGM content): standards and their recurring obligations
-- ---------------------------------------------------------------------------
create table public.library_standards (
  code        text primary key check (code ~ '^[A-Z]{2,4}-[A-Z0-9.\-]+$'),  -- PRC-005 (no version)
  version     text not null,
  title       text not null,
  family      text not null,
  applies     text[] not null default '{}',
  url         text check (url is null or url ~ '^https://'),
  notes       text,
  custom      boolean not null default false,
  updated_at  timestamptz not null default now()
);

create table public.obligation_templates (
  id               uuid primary key default gen_random_uuid(),
  standard_code    text not null references public.library_standards on update cascade on delete cascade,
  req              text not null default '',
  title            text not null,
  recur_n          int not null default 0 check (recur_n >= 0),   -- 0 = event-driven / one-time
  recur_unit       text not null default 'm' check (recur_unit in ('d','m','y')),
  recur_basis      text not null default 'due' check (recur_basis in ('due','done')),
  basis_confirmed  boolean not null default false,                 -- false = built-in suggestion, CGM to confirm
  pos              int
);
create index obligation_templates_std_idx on public.obligation_templates (standard_code);

create table public.task_plans (
  id             text primary key,
  title          text not null,
  standard_code  text,
  body           text not null default '',         -- one step per line; "## " section, "### " subsection, "- " bullet
  matches        text[] not null default '{}',     -- lowercased "<standard>|<task title>"
  plan_group     text,
  pos            int,
  source         text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users
);

-- ---------------------------------------------------------------------------
-- NERC compliance tasks (per client)
-- ---------------------------------------------------------------------------
create table public.tasks (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies on delete cascade,
  title          text not null check (length(title) > 0),
  facility       text,
  standard_code  text references public.library_standards on update cascade on delete restrict,
  requirement    text,
  due_date       date,
  assignee_text  text,                                  -- free text, as in the pilot
  assignee_id    uuid references public.profiles on delete set null,
  remind_days    int[] not null default '{30,7}',
  recur_n        int not null default 0 check (recur_n >= 0),
  recur_unit     text not null default 'm' check (recur_unit in ('d','m','y')),
  recur_basis    text not null default 'due' check (recur_basis in ('due','done')),
  status         text not null default 'open' check (status in ('open','inprogress','review','done')),
  evidence       text,                                  -- https link counts as the report
  notes          text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users,
  completed_at   date check (completed_at is null or completed_at <= (now() at time zone 'utc')::date + 1),
  performed_by   uuid references auth.users,
  reviewed_at    date,
  reviewed_by    uuid references auth.users,
  prev_id        uuid references public.tasks on delete set null,
  next_id        uuid references public.tasks on delete set null,
  copied_from    uuid references public.tasks on delete set null,
  plan_id        text,                                  -- task_plans.id, 'none', or null (match by title)
  sample         boolean not null default false
);
create index tasks_company_due_idx on public.tasks (company_id, status, due_date);

-- Next due date for a recurring task (pilot rules: months clamp to month end; years fall due Dec 31).
create or replace function public.next_due(base date, n int, unit text) returns date
language sql immutable as $$
  select case unit
    when 'd' then base + n
    when 'y' then make_date(extract(year from base)::int + n, 12, 31)
    else (base + make_interval(months => n))::date
  end
$$;

-- When a task becomes performed (review) or done, create its next occurrence once.
create or replace function public.spawn_next_occurrence() returns trigger
language plpgsql security definer set search_path = public as $$
declare base date; nid uuid;
begin
  if new.status in ('review','done') and old.status not in ('review','done')
     and new.recur_n > 0 and new.next_id is null then
    base := case when new.recur_basis = 'done' then coalesce(new.completed_at, current_date) else new.due_date end;
    if base is null then return new; end if;
    insert into tasks (company_id, title, facility, standard_code, requirement, due_date, assignee_text, assignee_id,
                       remind_days, recur_n, recur_unit, recur_basis, status, notes, created_by, prev_id, plan_id)
    values (new.company_id, new.title, new.facility, new.standard_code, new.requirement,
            public.next_due(base, new.recur_n, new.recur_unit), new.assignee_text, new.assignee_id,
            new.remind_days, new.recur_n, new.recur_unit, new.recur_basis, 'open', null, auth.uid(), new.id, new.plan_id)
    returning id into nid;
    new.next_id := nid;
  end if;
  return new;
end $$;

-- Enforce who may change what on a task.
create or replace function public.guard_task_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;  -- service role / server jobs

  -- Approving (review -> done) or completing directly needs a PM or admin.
  if new.status = 'done' and old.status <> 'done' and not public.can_approve() then
    raise exception 'Only a CGM project manager or admin can approve and close a task' using errcode = '42501';
  end if;

  if not public.is_staff() then
    -- Client users: mark performed, post evidence, add notes. Nothing else.
    if (new.company_id, new.title, new.facility, new.standard_code, new.requirement, new.due_date, new.assignee_text,
        new.assignee_id, new.remind_days, new.recur_n, new.recur_unit, new.recur_basis, new.reviewed_at, new.reviewed_by,
        new.prev_id, new.next_id, new.copied_from, new.plan_id, new.sample, new.created_at, new.created_by)
       is distinct from
       (old.company_id, old.title, old.facility, old.standard_code, old.requirement, old.due_date, old.assignee_text,
        old.assignee_id, old.remind_days, old.recur_n, old.recur_unit, old.recur_basis, old.reviewed_at, old.reviewed_by,
        old.prev_id, old.next_id, old.copied_from, old.plan_id, old.sample, old.created_at, old.created_by) then
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
    if new.status = 'open' and old.status = 'review' then  -- "Send back"
      new.performed_by := null; new.completed_at := null;
    end if;
  end if;
  return new;
end $$;

create trigger tasks_guard before update on public.tasks for each row execute function public.guard_task_update();
create trigger tasks_next  before update on public.tasks for each row execute function public.spawn_next_occurrence();
-- Postgres fires same-timing triggers alphabetically: tasks_guard runs before tasks_next.

-- ---------------------------------------------------------------------------
-- Client Tasks add-on (non-NERC work, per client)
-- ---------------------------------------------------------------------------
create table public.client_tasks (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies on delete cascade,
  title         text not null check (length(title) > 0),
  description   text,
  notes         text,
  category      text,
  assigned_to   text,
  party         text not null default 'client' check (party in ('client','contractor','cgm','agency','other')),
  due_date      date,
  completed_at  date,
  priority      text not null default 'normal' check (priority in ('low','normal','high')),
  status        text not null default 'notstarted' check (status in ('notstarted','inprogress','onhold','done')),
  recur_n       int not null default 0 check (recur_n >= 0),
  recur_unit    text not null default 'm' check (recur_unit in ('d','m','y')),
  links         jsonb not null default '[]',      -- [{label, url}] https only (checked in the app)
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users,
  prev_id       uuid references public.client_tasks on delete set null,
  next_id       uuid references public.client_tasks on delete set null
);
create index client_tasks_company_idx on public.client_tasks (company_id, status, due_date);

create or replace function public.spawn_next_client_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if new.status = 'done' and old.status <> 'done' and new.recur_n > 0 and new.next_id is null and new.due_date is not null then
    insert into client_tasks (company_id, title, description, category, assigned_to, party, due_date, priority, status,
                              recur_n, recur_unit, links, created_by, prev_id)
    values (new.company_id, new.title, new.description, new.category, new.assigned_to, new.party,
            public.next_due(new.due_date, new.recur_n, new.recur_unit), new.priority, 'notstarted',
            new.recur_n, new.recur_unit, new.links, auth.uid(), new.id)
    returning id into nid;
    new.next_id := nid;
    new.completed_at := coalesce(new.completed_at, current_date);
  end if;
  return new;
end $$;
create trigger client_tasks_next before update on public.client_tasks for each row execute function public.spawn_next_client_task();

-- ---------------------------------------------------------------------------
-- Team tasks (internal CGM work)
-- ---------------------------------------------------------------------------
create table public.team_tasks (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(title) > 0),
  description    text,
  company_id     uuid references public.companies on delete set null,   -- null = internal
  owner_id       uuid references public.profiles on delete set null,
  collaborators  uuid[] not null default '{}',
  planned_date   date,
  actual_date    date,
  est_hours      numeric(6,2),
  status         text not null default 'notstarted' check (status in ('notstarted','inprogress','onhold','review','done')),
  links          jsonb not null default '[]',
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users
);

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
create table public.chats (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('channel','dm','client')),
  name        text,                                      -- channel
  members     uuid[] not null default '{}',              -- dm
  company_id  uuid references public.companies on delete cascade,  -- client
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users,
  last_at     timestamptz,
  check ((type = 'client') = (company_id is not null)),
  check (type <> 'dm' or cardinality(members) = 2)
);
create unique index chats_one_per_client on public.chats (company_id) where type = 'client';

create table public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chats on delete cascade,
  author_id   uuid not null references auth.users default auth.uid(),
  body        text not null check (length(body) <= 4000),
  task_ref    jsonb,                                     -- {kind: "task"|"ctask", id, label}
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index chat_messages_chat_idx on public.chat_messages (chat_id, created_at);

create table public.chat_reads (
  user_id   uuid not null references auth.users on delete cascade default auth.uid(),
  chat_id   uuid not null references public.chats on delete cascade,
  read_at   timestamptz not null default now(),
  primary key (user_id, chat_id)
);

create or replace function public.can_see_chat(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from chats ch where ch.id = c and (
      (ch.type = 'dm' and auth.uid() = any (ch.members))
      or (ch.type = 'channel' and public.is_staff())
      or (ch.type = 'client' and (public.is_staff() or public.client_can(ch.company_id, 'tracker')))
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- Audit log: append-only, written only by triggers
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,                      -- null = system / service role
  action      text not null,             -- created | updated | performed | approved | sent_back | completed | deleted
  kind        text not null,             -- task | ctask | team | client | standard | plan | entitlement
  target_id   text not null,
  company_id  uuid,
  label       text,
  old_row     jsonb,
  new_row     jsonb
);
create index activity_log_company_idx on public.activity_log (company_id, at desc);

create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text := tg_argv[0];
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  act text := lower(tg_op) || 'd';
begin
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

create trigger log_tasks        after insert or update or delete on public.tasks              for each row execute function public.log_change('task');
create trigger log_client_tasks after insert or update or delete on public.client_tasks       for each row execute function public.log_change('ctask');
create trigger log_team_tasks   after insert or update or delete on public.team_tasks         for each row execute function public.log_change('team');
create trigger log_companies    after insert or update or delete on public.companies          for each row execute function public.log_change('client');
create trigger log_library      after insert or update or delete on public.library_standards  for each row execute function public.log_change('standard');
create trigger log_plans        after insert or update or delete on public.task_plans         for each row execute function public.log_change('plan');
create trigger log_entitlements after insert or update or delete on public.entitlements       for each row execute function public.log_change('entitlement');

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.library_standards    enable row level security;
alter table public.obligation_templates enable row level security;
alter table public.task_plans           enable row level security;
alter table public.tasks                enable row level security;
alter table public.client_tasks         enable row level security;
alter table public.team_tasks           enable row level security;
alter table public.chats                enable row level security;
alter table public.chat_messages        enable row level security;
alter table public.chat_reads           enable row level security;
alter table public.activity_log         enable row level security;

-- Library: tracker clients read; CGM admins and PMs edit.
create policy "library read"  on public.library_standards    for select using (public.has_product('tracker'));
create policy "library write" on public.library_standards    for all using (public.can_approve()) with check (public.can_approve());
create policy "templates read"  on public.obligation_templates for select using (public.has_product('tracker'));
create policy "templates write" on public.obligation_templates for all using (public.can_approve()) with check (public.can_approve());

-- Task plans are CGM know-how: staff only.
create policy "plans staff" on public.task_plans for all using (public.is_staff()) with check (public.is_staff());

-- Tasks
create policy "tasks read"   on public.tasks for select using (public.is_staff() or public.client_can(company_id, 'tracker'));
create policy "tasks insert" on public.tasks for insert with check (public.is_staff());
create policy "tasks update" on public.tasks for update using (public.is_staff() or public.client_can(company_id, 'tracker'))
                                                    with check (public.is_staff() or public.client_can(company_id, 'tracker'));
create policy "tasks delete" on public.tasks for delete using (public.is_staff());

-- Client Tasks add-on: staff, or the client's own users while the add-on is live.
create policy "ctasks all" on public.client_tasks for all
  using (public.is_staff() or public.client_can(company_id, 'client_tasks'))
  with check (public.is_staff() or public.client_can(company_id, 'client_tasks'));

-- Team tasks: staff only.
create policy "team staff" on public.team_tasks for all using (public.is_staff()) with check (public.is_staff());

-- Messages
create policy "chats read"   on public.chats for select using (public.can_see_chat(id));
create policy "chats create" on public.chats for insert with check (
  (type = 'channel' and public.is_staff())
  or (type = 'dm' and auth.uid() = any (members) and public.is_staff())
  or (type = 'client' and (public.is_staff() or public.client_can(company_id, 'tracker')))
);
create policy "chats touch"  on public.chats for update using (public.can_see_chat(id)) with check (public.can_see_chat(id));
create policy "messages read"   on public.chat_messages for select using (public.can_see_chat(chat_id));
create policy "messages send"   on public.chat_messages for insert with check (author_id = auth.uid() and public.can_see_chat(chat_id));
create policy "messages delete own" on public.chat_messages for update using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "reads own" on public.chat_reads for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Audit log: staff read everything; client users read their own company's task history. No one writes directly.
create policy "log read" on public.activity_log for select using (
  public.is_staff() or (kind in ('task','ctask') and public.client_can(company_id, 'tracker'))
);
