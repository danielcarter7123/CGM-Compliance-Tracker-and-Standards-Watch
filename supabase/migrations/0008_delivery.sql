-- W5 delivery: alert emails, unsubscribe, corrections.
--
-- - profiles.alerts_opt_in: separate from the weekly digest; each email's unsubscribe link turns off its own kind.
-- - drafts.previous: the published value an approved draft replaced, so the digest can list corrections
--   (changed dates, removed entries) and alerts can spot new FERC approvals and new effective dates.
-- - alert_log: one row per alert sent, so the same alert never goes out twice. Staff read it; nobody writes
--   it through the API (the alert job uses the service role).

alter table public.profiles add column alerts_opt_in boolean not null default true;
comment on column public.profiles.alerts_opt_in is 'Standards Watch alert emails (new FERC approvals, new effective dates, deadlines within 14 days).';

alter table public.drafts add column previous jsonb;
comment on column public.drafts.previous is 'On approval: the published value this draft replaced (null for a new entry).';

create table public.alert_log (
  key         text primary key,          -- e.g. ferc:<draft id>, effective:<draft id>, deadline:<id>:<date>
  kind        text not null check (kind in ('ferc','effective','deadline')),
  label       text not null,
  recipients  int not null default 0,
  sent_at     timestamptz not null default now()
);
alter table public.alert_log enable row level security;
create policy "alert log read" on public.alert_log for select using (public.is_staff());
