-- Dan's refinement of 0009 (docs/OPEN-QUESTIONS.md, 14): the weekly digest stays the default and only
-- email most people get, but anyone who really wants a note for each change can turn alerts on.
-- Brings back what 0009 removed, with alerts OFF by default.

alter table public.profiles add column alerts_opt_in boolean not null default false;
comment on column public.profiles.alerts_opt_in is 'Optional Standards Watch alert emails (new FERC approvals, effective dates, deadlines within 14 days). Off unless the person turns them on.';

create table public.alert_log (
  key         text primary key,          -- ferc:<draft id>, effective:<draft id>, deadline:<id>:<date>
  kind        text not null check (kind in ('ferc','effective','deadline')),
  label       text not null,
  recipients  int not null default 0,
  sent_at     timestamptz not null default now()
);
alter table public.alert_log enable row level security;
create policy "alert log read" on public.alert_log for select using (public.is_staff());
