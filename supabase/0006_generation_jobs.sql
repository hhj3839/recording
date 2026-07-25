create table if not exists generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_email text not null,
  class_id bigint not null,
  job_type text not null check (job_type in ('comments')),
  status text not null check (status in ('queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled')),
  batches jsonb not null default '[]'::jsonb,
  current_batch integer not null default 0,
  total_batches integer not null default 0,
  total_items integer not null default 0,
  completed_items integer not null default 0,
  failed_items integer not null default 0,
  error_message text not null default '',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists generation_jobs_owner_class_created_idx
  on generation_jobs(owner_id, class_id, created_at desc);

create unique index if not exists generation_jobs_one_active_idx
  on generation_jobs(owner_id, class_id, job_type)
  where status in ('queued', 'running');

alter table generation_jobs enable row level security;
revoke all on generation_jobs from anon, authenticated;
