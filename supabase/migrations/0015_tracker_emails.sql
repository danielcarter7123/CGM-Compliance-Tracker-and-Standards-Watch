-- T8 Tracker emails (TRACKER-SPEC §6; OPEN-QUESTIONS 1, 6, 7). All of them are sent by one weekday job, only while
-- automated emails are switched on (app_settings.emails_enabled, and no EMAILS_DISABLED in the environment).
-- - email_optouts: unsubscribes by email address, so people without a login (client contacts, imported assignees)
--   can stop an email too. A signed-in person manages their own rows from the account page.
-- - tracker_email_log: one row per email sent per day, so a retried run never sends twice. Written by the job
--   (service role) only; CGM staff can read it.

create table public.email_optouts (
  email       text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  kind        text not null check (kind in ('tracker_digest', 'tracker_reminders', 'messages')),
  created_at  timestamptz not null default now(),
  primary key (email, kind)
);
alter table public.email_optouts enable row level security;

-- The signed-in person's own email address (lowercase).
create or replace function public.my_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(email) from profiles where id = auth.uid()
$$;

create policy "optouts own read"   on public.email_optouts for select using (email = public.my_email() or public.is_staff());
create policy "optouts own add"    on public.email_optouts for insert with check (email = public.my_email());
create policy "optouts own remove" on public.email_optouts for delete using (email = public.my_email());

create table public.tracker_email_log (
  key         text primary key,   -- <kind>:<recipient>:<YYYY-MM-DD>
  kind        text not null check (kind in ('client_digest', 'pm_digest', 'reminders', 'messages')),
  recipient   text not null,
  items       int not null default 0,
  sent_at     timestamptz not null default now()
);
create index tracker_email_log_recipient_idx on public.tracker_email_log (recipient, kind, sent_at desc);
alter table public.tracker_email_log enable row level security;
create policy "tracker email log read" on public.tracker_email_log for select using (public.is_staff());
