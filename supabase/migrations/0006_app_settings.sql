-- App-wide switches set by a CGM admin. First use: the master switch for automated emails
-- (tracker reminders, message notices, digests sent on a schedule). Ships OFF; Dan turns it on after launch.
-- The EMAILS_DISABLED environment variable can also force email off, whatever this says.

create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users default auth.uid()
);

insert into public.app_settings (key, value) values ('emails_enabled', 'false');

alter table public.app_settings enable row level security;
create policy "settings read" on public.app_settings for select using (public.is_staff());
create policy "settings write" on public.app_settings for update
  using (public.staff_role() = 'admin') with check (public.staff_role() = 'admin');

create or replace function public.touch_app_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger app_settings_touch before update on public.app_settings for each row execute function public.touch_app_settings();
