create table if not exists public.auth_login_attempts (
  attempt_key text primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.auth_login_attempts enable row level security;
revoke all on public.auth_login_attempts from anon, authenticated;
