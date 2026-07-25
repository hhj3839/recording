alter table generated_comments
  add column if not exists evidence_status text not null default 'unchecked'
    check (evidence_status in ('unchecked', 'pass', 'review')),
  add column if not exists evidence_issues jsonb not null default '[]'::jsonb,
  add column if not exists evidence_hash text,
  add column if not exists evidence_validated_at timestamptz;
