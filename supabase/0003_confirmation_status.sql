alter table generated_comments
  add column if not exists confirmed boolean not null default false,
  add column if not exists confirmed_at timestamptz;

alter table student_behaviors
  add column if not exists confirmed boolean not null default false,
  add column if not exists confirmed_at timestamptz;
