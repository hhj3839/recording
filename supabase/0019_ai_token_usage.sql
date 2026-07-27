alter table ai_usage_events
  add column if not exists model text,
  add column if not exists input_tokens bigint not null default 0,
  add column if not exists cached_input_tokens bigint not null default 0,
  add column if not exists output_tokens bigint not null default 0,
  add column if not exists total_tokens bigint not null default 0,
  add column if not exists estimated_cost_usd numeric(12, 6);

