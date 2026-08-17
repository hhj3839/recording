alter table generated_comments
  add column if not exists generation_levels jsonb not null default '[]'::jsonb;
