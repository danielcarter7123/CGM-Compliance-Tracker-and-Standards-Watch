-- The weekly Standards Watch drafting job (lib/watch-job.ts): one row per run, so editors can see what it
-- did, what it couldn't confirm, and roughly what it cost. The job only ever creates drafts (CLAUDE.md rule 4).
-- Editors read this; nothing writes it through the API (the job uses the service role).

create table public.watch_job_runs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  trigger         text not null check (trigger in ('cron','manual')),
  status          text not null default 'running' check (status in ('running','ok','error','skipped')),
  drafts_queued   int not null default 0,
  summary         text,
  unconfirmed     jsonb not null default '[]',
  sources_checked jsonb not null default '[]',
  error           text,
  model           text,
  input_tokens    int,
  output_tokens   int,
  web_searches    int,
  est_cost_usd    numeric(8,2)
);
create index watch_job_runs_started_idx on public.watch_job_runs (started_at desc);
alter table public.watch_job_runs enable row level security;
create policy "job runs read" on public.watch_job_runs for select using (public.is_editor());
