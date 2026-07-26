alter table generated_comments
  add column if not exists candidates jsonb not null default '[]'::jsonb;
