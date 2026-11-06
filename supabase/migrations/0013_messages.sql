-- T6 Messages (TRACKER-SPEC §3.10, Dan's decision 6): in-app chat in CGM Compliance Tracker.
-- Tightens 0003's chat rules and adds what the screens need:
-- - Client users may start a direct message with their own company's CGM project manager (companies.pm_id).
-- - A message can only be soft-deleted by its author: no edits, no moving it to another conversation.
-- - Nobody updates a conversation through the API; a trigger records its last activity (last_at, last_by).
-- - One direct-message conversation per pair of people; "General" always exists.
-- - Display names for the people in your conversations (client users can't read staff profiles directly).
-- - Live updates through Supabase Realtime, where the publication exists.

alter table public.chats add column last_by uuid references auth.users on delete set null;

-- Conversation activity is set by the database when a message is posted.
create or replace function public.touch_chat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update chats set last_at = new.created_at, last_by = new.author_id where id = new.chat_id;
  return null;
end $$;
create trigger chat_messages_touch after insert on public.chat_messages for each row execute function public.touch_chat();
drop policy "chats touch" on public.chats;

-- Direct messages: members sorted so each pair has one conversation.
create or replace function public.normalize_dm() returns trigger
language plpgsql as $$
begin
  if new.type = 'dm' then new.members := array(select distinct m from unnest(new.members) m order by m); end if;
  return new;
end $$;
create trigger chats_normalize before insert on public.chats for each row execute function public.normalize_dm();
create unique index chats_one_dm_per_pair on public.chats (members) where type = 'dm';

-- The signed-in client user's own CGM project manager (null for staff, or when the company has no Tracker or PM).
create or replace function public.my_pm() returns uuid
language sql stable security definer set search_path = public as $$
  select c.pm_id from companies c
  where c.id = public.my_company() and not public.is_staff() and public.company_has(c.id, 'tracker')
$$;

drop policy "chats create" on public.chats;
create policy "chats create" on public.chats for insert with check (
  (type = 'channel' and public.is_staff())
  or (type = 'dm' and auth.uid() = any (members) and cardinality(members) = 2
      and (public.is_staff() or public.my_pm() = any (members)))
  or (type = 'client' and (public.is_staff() or public.client_can(company_id, 'tracker')))
);

-- Messages: the author may only soft-delete (set deleted_at); nothing else changes.
drop policy "messages delete own" on public.chat_messages;
create policy "messages delete own" on public.chat_messages for update
  using (author_id = auth.uid()) with check (author_id = auth.uid() and public.can_see_chat(chat_id));
create or replace function public.guard_message_update() returns trigger
language plpgsql as $$
begin
  if (new.chat_id, new.author_id, new.body, new.task_ref, new.created_at) is distinct from
     (old.chat_id, old.author_id, old.body, old.task_ref, old.created_at)
     or new.deleted_at is null then
    raise exception 'Messages can''t be edited, only deleted' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger chat_messages_guard before update on public.chat_messages for each row execute function public.guard_message_update();

-- Names of people the signed-in user may see in conversations: CGM staff, people in their own company,
-- and (for staff) everyone. Returns only id and a display name.
create or replace function public.people_names(ids uuid[]) returns table (id uuid, name text, staff boolean)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)), p.staff_role is not null
  from profiles p
  where p.id = any (ids)
    and (public.is_staff() or p.staff_role is not null or (p.company_id is not null and p.company_id = public.my_company()))
$$;

-- "General" is always there for CGM staff.
insert into public.chats (type, name) select 'channel', 'General'
where not exists (select 1 from public.chats where type = 'channel' and name = 'General');

-- Live updates (Supabase Realtime respects row level security). Skipped where there is no realtime publication.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_messages, public.chats;
  end if;
end $$;
