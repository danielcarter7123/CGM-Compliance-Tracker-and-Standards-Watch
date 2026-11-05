-- Evidence: SharePoint linked seamlessly, plus file upload.
-- Each piece of evidence is one row: a file uploaded to the app's private storage, a file picked from (or
-- uploaded to) the client's SharePoint folder, or a plain https link. tasks.evidence (the pilot's single link)
-- stays for imported data and keeps working. See docs/EVIDENCE.md.

alter table public.companies
  add column sharepoint_drive_id   text,   -- resolved from sharepoint_url through Microsoft Graph (/shares/{id}/driveItem)
  add column sharepoint_item_id    text,
  add column evidence_destination  text not null default 'sharepoint' check (evidence_destination in ('sharepoint','app'));

comment on column public.companies.evidence_destination is
  'Where "Upload file" saves: the client''s SharePoint folder (default, when connected) or the app''s private storage.';

create table public.evidence (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies on delete cascade,
  task_id         uuid references public.tasks on delete cascade,
  client_task_id  uuid references public.client_tasks on delete cascade,
  kind            text not null check (kind in ('file','sharepoint','link')),
  title           text,
  -- link / sharepoint
  url             text check (url is null or url ~ '^https://'),
  sp_drive_id     text,
  sp_item_id      text,
  sp_etag         text,
  -- file in app storage (bucket "evidence", path "<company_id>/<task_id>/<uuid>-<file name>")
  storage_path    text,
  file_name       text,
  size_bytes      bigint check (size_bytes is null or size_bytes >= 0),
  mime_type       text,
  sha256          text,
  performed_on    date,                         -- date of the work the evidence shows, if known
  added_by        uuid not null default auth.uid() references auth.users,
  created_at      timestamptz not null default now(),
  removed_at      timestamptz,                  -- soft delete: evidence is never silently lost
  removed_by      uuid references auth.users,
  check (num_nonnulls(task_id, client_task_id) = 1),
  check (kind <> 'file' or storage_path is not null),
  check (kind <> 'sharepoint' or (sp_drive_id is not null and sp_item_id is not null and url is not null)),
  check (kind <> 'link' or url is not null)
);
create index evidence_task_idx on public.evidence (task_id) where removed_at is null;
create index evidence_ctask_idx on public.evidence (client_task_id) where removed_at is null;

-- Evidence must belong to the same company as its task, and its storage path must sit under that company.
create or replace function public.check_evidence() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if new.task_id is not null then select company_id into owner from tasks where id = new.task_id;
  else select company_id into owner from client_tasks where id = new.client_task_id; end if;
  if owner is null or owner <> new.company_id then
    raise exception 'Evidence must belong to the same client as its task' using errcode = '42501';
  end if;
  if new.storage_path is not null and split_part(new.storage_path, '/', 1) <> new.company_id::text then
    raise exception 'Evidence files must be stored under their client''s folder' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null then
    -- Only the soft-delete fields may change after the fact.
    if (new.company_id, new.task_id, new.client_task_id, new.kind, new.url, new.sp_drive_id, new.sp_item_id, new.storage_path,
        new.file_name, new.size_bytes, new.sha256, new.added_by, new.created_at)
       is distinct from
       (old.company_id, old.task_id, old.client_task_id, old.kind, old.url, old.sp_drive_id, old.sp_item_id, old.storage_path,
        old.file_name, old.size_bytes, old.sha256, old.added_by, old.created_at) then
      raise exception 'Evidence can''t be edited; add a new item and remove the old one' using errcode = '42501';
    end if;
    if new.removed_at is not null and old.removed_at is null then new.removed_by := auth.uid(); end if;
  end if;
  return new;
end $$;
create trigger evidence_check before insert or update on public.evidence for each row execute function public.check_evidence();
create trigger log_evidence after insert or update or delete on public.evidence for each row execute function public.log_change('evidence');

-- Who may see / add evidence for a row: the same people who may see the task.
create or replace function public.can_use_evidence(cid uuid, is_ctask boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or public.client_can(cid, case when is_ctask then 'client_tasks' else 'tracker' end)
$$;

alter table public.evidence enable row level security;
create policy "evidence read"   on public.evidence for select using (public.can_use_evidence(company_id, client_task_id is not null));
create policy "evidence add"    on public.evidence for insert with check (added_by = auth.uid() and public.can_use_evidence(company_id, client_task_id is not null));
create policy "evidence remove" on public.evidence for update
  using (public.is_staff() or (added_by = auth.uid() and public.can_use_evidence(company_id, client_task_id is not null)))
  with check (public.is_staff() or (added_by = auth.uid() and public.can_use_evidence(company_id, client_task_id is not null)));
create policy "evidence purge"  on public.evidence for delete using (public.staff_role() = 'admin');

-- Audit-log readers: clients see their own evidence history alongside their task history.
drop policy "log read" on public.activity_log;
create policy "log read" on public.activity_log for select using (
  public.is_staff() or (kind in ('task','ctask','evidence') and public.client_can(company_id, 'tracker'))
);

-- ---------------------------------------------------------------------------
-- Private file storage (Supabase Storage). Bucket "evidence"; object names start with the company id.
-- ---------------------------------------------------------------------------
create or replace function public.path_company(name text) returns uuid
language sql immutable as $$
  select case when split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(name, '/', 1)::uuid end
$$;

insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false) on conflict (id) do nothing;

create policy "evidence files read" on storage.objects for select
  using (bucket_id = 'evidence' and (public.is_staff() or public.client_can(public.path_company(name), 'tracker')
                                     or public.client_can(public.path_company(name), 'client_tasks')));
create policy "evidence files upload" on storage.objects for insert
  with check (bucket_id = 'evidence' and (public.is_staff() or public.client_can(public.path_company(name), 'tracker')
                                          or public.client_can(public.path_company(name), 'client_tasks')));
-- No update policy: files are immutable. Only CGM admins can delete files (e.g. a retention purge).
create policy "evidence files purge" on storage.objects for delete
  using (bucket_id = 'evidence' and public.staff_role() = 'admin');
