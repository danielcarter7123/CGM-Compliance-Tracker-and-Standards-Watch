-- T7 Activity Log (TRACKER-SPEC §3.11): Restore and Revert, kept append-only.
-- - Restore re-inserts a deleted record from the log entry's old_row. Restoring a client also brings back what was
--   deleted with it in the same moment (products, contacts, tasks, client tasks, evidence) and re-attaches its team tasks.
-- - Revert writes a change's old values back. It refuses when the record was changed since, unless confirmed.
-- - Both run as the signed-in person (row level security still decides each write), only for CGM staff, and the
--   ordinary triggers log every write they make, as "restored" or "reverted" with ref_id pointing at the entry acted on.
-- - Contacts are now logged too, so a restored client gets its contacts back.
-- Only entries recorded by this app (source 'app') can be restored or reverted; imported pilot history is shown as is.

alter table public.activity_log add column ref_id bigint references public.activity_log (id);
create index activity_log_ref_idx on public.activity_log (ref_id) where ref_id is not null;
create index activity_log_at_idx on public.activity_log (at desc);

create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text := tg_argv[0];
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  act text;
  mode text := coalesce(current_setting('app.log_action', true), '');
  ref bigint := nullif(coalesce(current_setting('app.log_ref', true), ''), '')::bigint;
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
  if mode in ('restored', 'reverted') then act := mode; else ref := null; end if;
  insert into activity_log (actor_id, action, kind, target_id, company_id, label, old_row, new_row, ref_id)
  values (auth.uid(), act, k, coalesce(r->>'id', r->>'code', r->>'company_id'),
          case when k = 'client' then (r->>'id')::uuid else (r->>'company_id')::uuid end,
          coalesce(r->>'title', r->>'name', r->>'code', r->>'product', r->>'label'), o, n, ref);
  return null;
end $$;

create trigger log_contacts after insert or update or delete on public.contacts for each row execute function public.log_change('contact');

-- The table behind each kind of log entry.
create or replace function public.log_table(k text) returns text
language sql immutable as $$
  select case k when 'task' then 'tasks' when 'ctask' then 'client_tasks' when 'team' then 'team_tasks'
                when 'client' then 'companies' when 'standard' then 'library_standards' when 'plan' then 'task_plans'
                when 'entitlement' then 'entitlements' when 'contact' then 'contacts' when 'evidence' then 'evidence' end
$$;

-- "where" for one record of a kind, matching the row described by r.
create or replace function public.log_key(k text, r jsonb, a text default 't') returns text
language sql immutable as $$
  select case k when 'standard' then format('%I.code = %L', a, r->>'code')
                when 'entitlement' then format('%I.company_id = %L and %I.product = %L', a, r->>'company_id', a, r->>'product')
                else format('%I.id = %L', a, r->>'id') end
$$;

-- Re-inserts one row. Links to other rows of the same chain that no longer exist are left empty; afterwards the
-- neighbours that pointed here are pointed back.
create or replace function public.restore_row(k text, r jsonb) returns void
language plpgsql set search_path = public as $$
declare tbl text := public.log_table(k); col text; ok boolean;
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
  begin
    execute format('insert into %I select * from jsonb_populate_record(null::%I, $1)', tbl, tbl) using r;
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

create or replace function public.restore_entry(p_id bigint) returns void
language plpgsql set search_path = public as $$
declare e activity_log; c activity_log;
begin
  if not public.is_staff() then raise exception 'Only CGM staff restore records' using errcode = '42501'; end if;
  select * into e from activity_log where id = p_id;
  if not found or e.action <> 'deleted' or e.source <> 'app' or e.old_row is null then
    raise exception 'Only deletions recorded by this app can be restored' using errcode = '22023';
  end if;
  if exists (select 1 from activity_log where ref_id = p_id and action = 'restored') then
    raise exception 'This deletion was already restored' using errcode = '22023';
  end if;
  perform set_config('app.log_action', 'restored', true);
  perform set_config('app.log_ref', p_id::text, true);
  perform public.restore_row(e.kind, e.old_row);
  if e.kind = 'client' then
    -- What was deleted with the client, in the same moment, in an order that satisfies the links.
    for c in
      select * from activity_log
      where source = 'app' and action = 'deleted' and at = e.at and id <> e.id and company_id = (e.target_id)::uuid
        and kind in ('entitlement', 'contact', 'task', 'ctask', 'evidence')
        and not exists (select 1 from activity_log x where x.ref_id = activity_log.id and x.action = 'restored')
      order by case kind when 'entitlement' then 0 when 'contact' then 1 when 'task' then 2 when 'ctask' then 3 else 4 end, id
    loop
      perform set_config('app.log_ref', c.id::text, true);
      perform public.restore_row(c.kind, c.old_row);
    end loop;
    -- Team tasks that lost the client then go back to it.
    for c in
      select * from activity_log
      where source = 'app' and kind = 'team' and at = e.at and old_row->>'company_id' = e.target_id and new_row->>'company_id' is null
    loop
      perform set_config('app.log_ref', c.id::text, true);
      update team_tasks set company_id = (e.target_id)::uuid where id = (c.target_id)::uuid and company_id is null;
    end loop;
  end if;
  perform set_config('app.log_action', '', true);
  perform set_config('app.log_ref', '', true);
end $$;

-- Writes a change's old values back. Returns null when done; when the record changed since and p_force is false,
-- changes nothing and returns when it was last changed (the screen then asks "Revert anyway?").
create or replace function public.revert_entry(p_id bigint, p_force boolean default false) returns timestamptz
language plpgsql set search_path = public as $$
declare e activity_log; tbl text; cols text[]; cur jsonb; since timestamptz; sets text;
begin
  if not public.is_staff() then raise exception 'Only CGM staff revert changes' using errcode = '42501'; end if;
  select * into e from activity_log where id = p_id;
  if not found or e.source <> 'app' or e.old_row is null or e.new_row is null then
    raise exception 'Only changes recorded by this app can be reverted' using errcode = '22023';
  end if;
  if exists (select 1 from activity_log where ref_id = p_id and action = 'reverted') then
    raise exception 'This change was already reverted' using errcode = '22023';
  end if;
  tbl := public.log_table(e.kind);
  if tbl is null then raise exception 'This kind of record can''t be reverted' using errcode = '22023'; end if;
  execute format('select to_jsonb(t) from %I t where %s', tbl, public.log_key(e.kind, e.new_row)) into cur;
  if cur is null then raise exception 'That record no longer exists. Restore it first.' using errcode = '22023'; end if;
  select array_agg(k order by k) into cols from jsonb_object_keys(e.old_row) k
  where e.old_row->k is distinct from e.new_row->k and k not in ('updated_at', 'legacy');
  if cols is null then raise exception 'There is nothing to revert in this entry' using errcode = '22023'; end if;
  select max(at) into since from activity_log
  where kind = e.kind and target_id = e.target_id and id > e.id;
  if since is not null and not p_force then return since; end if;
  select string_agg(format('%I = r.%I', c, c), ', ') into sets from unnest(cols) c;
  perform set_config('app.log_action', 'reverted', true);
  perform set_config('app.log_ref', p_id::text, true);
  execute format('update %I t set %s from jsonb_populate_record(null::%I, $1) r where %s', tbl, sets, tbl,
                 public.log_key(e.kind, e.new_row)) using e.old_row;
  perform set_config('app.log_action', '', true);
  perform set_config('app.log_ref', '', true);
  return null;
end $$;
