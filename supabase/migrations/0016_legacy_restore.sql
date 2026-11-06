-- T9 prep: Restore records that were deleted in the pilot tracker before the move (Activity Log).
-- The pilot kept a copy of each deleted task, client (with its tasks) and standard (legacy_snapshots). The server turns
-- a copy into rows with the importer's own mapping (lib/legacy-map.ts) and passes them here. This function checks
-- the entry, then inserts them as the signed-in person (row level security applies to every write; restoring a client
-- needs a CGM admin, because products are admin-only). The ordinary triggers log each write as "restored", with
-- ref_id pointing at the pilot's deletion entry, so it can be restored only once. All or nothing.

create or replace function public.log_table(k text) returns text
language sql immutable as $$
  select case k when 'task' then 'tasks' when 'ctask' then 'client_tasks' when 'team' then 'team_tasks'
                when 'client' then 'companies' when 'standard' then 'library_standards' when 'plan' then 'task_plans'
                when 'entitlement' then 'entitlements' when 'contact' then 'contacts' when 'evidence' then 'evidence'
                when 'template' then 'obligation_templates' end
$$;

create or replace function public.restore_legacy(p_id bigint, p_rows jsonb) returns int
language plpgsql set search_path = public as $$
declare e activity_log; r jsonb; n int := 0;
begin
  if not public.is_staff() then raise exception 'Only CGM staff restore records' using errcode = '42501'; end if;
  select * into e from activity_log where id = p_id;
  if not found or e.source <> 'legacy' or e.action <> 'deleted' or coalesce(e.legacy->>'hasSnap', '') <> 'true' then
    raise exception 'Only pilot deletions with a saved copy can be restored this way' using errcode = '22023';
  end if;
  if e.legacy->>'restoredAt' is not null or exists (select 1 from activity_log where ref_id = p_id and action = 'restored') then
    raise exception 'This deletion was already restored' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nothing to restore' using errcode = '22023';
  end if;
  perform set_config('app.log_action', 'restored', true);
  perform set_config('app.log_ref', p_id::text, true);
  for r in select value from jsonb_array_elements(p_rows) loop
    if r->>'kind' not in ('task', 'client', 'contact', 'entitlement', 'standard', 'template') then
      raise exception 'Restore can''t write % records', r->>'kind' using errcode = '22023';
    end if;
    perform public.restore_row(r->>'kind', r->'row');
    n := n + 1;
  end loop;
  perform set_config('app.log_action', '', true);
  perform set_config('app.log_ref', '', true);
  return n;
end $$;

-- A client's project manager (companies.pm_id) must be CGM staff: it decides who the client's users may message
-- directly (my_pm, 0013) and who gets the client in their PM digest.
create or replace function public.check_company_pm() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pm_id is not null and (tg_op = 'INSERT' or new.pm_id is distinct from old.pm_id)
     and not exists (select 1 from profiles where id = new.pm_id and staff_role is not null) then
    raise exception 'The project manager must be a CGM staff member' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger companies_pm_check before insert or update of pm_id on public.companies
  for each row execute function public.check_company_pm();

-- restore_row (0014) again: insert only the fields the saved row has, so any others take their column defaults
-- (a saved copy may predate a column). Links to rows that no longer exist are left empty, as before.
create or replace function public.restore_row(k text, r jsonb) returns void
language plpgsql set search_path = public as $$
declare tbl text := public.log_table(k); col text; ok boolean; cols text;
begin
  if tbl is null then raise exception 'This kind of record can''t be restored' using errcode = '22023'; end if;
  if k in ('task', 'ctask') then
    foreach col in array case when k = 'task' then array['prev_id','next_id','copied_from'] else array['prev_id','next_id'] end loop
      if r->>col is not null then
        execute format('select exists (select 1 from %I where id = $1)', tbl) using (r->>col)::uuid into ok;
        if not ok then r := r - col; end if;
      end if;
    end loop;
  end if;
  select string_agg(format('%I', a.attname), ', ' order by a.attnum) into cols
  from pg_attribute a
  where a.attrelid = format('public.%I', tbl)::regclass and a.attnum > 0 and not a.attisdropped
    and a.attidentity = '' and a.attgenerated = '' and r ? a.attname;
  if cols is null then raise exception 'Nothing to restore' using errcode = '22023'; end if;
  begin
    execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1)', tbl, cols, cols, tbl) using r;
  exception when unique_violation then
    raise exception 'This record already exists, so it can''t be restored' using errcode = '23505';
  end;
  if k in ('task', 'ctask') then
    if r->>'next_id' is not null then
      execute format('update %I set prev_id = $1 where id = $2 and prev_id is null', tbl) using (r->>'id')::uuid, (r->>'next_id')::uuid;
    end if;
    if r->>'prev_id' is not null then
      execute format('update %I set next_id = $1 where id = $2 and next_id is null', tbl) using (r->>'id')::uuid, (r->>'prev_id')::uuid;
    end if;
  end if;
end $$;
