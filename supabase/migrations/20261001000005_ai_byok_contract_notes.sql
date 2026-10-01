-- Source: quantspulse_supabase_schema.md §5.5 AI (BYOK) and Contract-Note Imports
-- =====================================================================
-- 5.5 BYOK AI keys, AI usage, contract-note imports
-- =====================================================================
create table public.ai_provider_keys (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      public.ai_provider not null,
  label         text not null default 'default',
  key_last4     text not null check (char_length(key_last4) = 4),
  default_model text,
  status        text not null default 'active' check (status in ('active', 'invalid', 'revoked')),
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, tenant_id, provider, label)
);

create table private.ai_key_secrets (
  key_id      uuid primary key references public.ai_provider_keys(id) on delete cascade,
  ciphertext  bytea not null,
  iv          bytea not null,
  auth_tag    bytea not null,
  key_version smallint not null,
  updated_at  timestamptz not null default now()
);

-- Metering only. Deliberately NO prompt or response columns.
create table public.ai_usage_logs (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  key_id        uuid references public.ai_provider_keys(id) on delete set null,
  provider      public.ai_provider not null,
  model         text,
  feature       text not null,       -- 'chat' | 'contract_note_import' | 'news_summary'
  input_tokens  integer,
  output_tokens integer,
  latency_ms    integer,
  status        text not null default 'ok',
  created_at    timestamptz not null default now()
);
create index ai_usage_owner_idx on public.ai_usage_logs (user_id, tenant_id, created_at desc);

create table public.contract_note_imports (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  storage_path    text not null,     -- '{user_id}/{id}.pdf' in the private bucket
  status          text not null default 'uploaded'
                    check (status in ('uploaded', 'parsing', 'parsed', 'failed')),
  holdings_parsed integer,
  error           text,
  file_deleted_at timestamptz,       -- file removed after parsing (see retention)
  created_at      timestamptz not null default now()
);
create index contract_note_imports_owner_idx on public.contract_note_imports (user_id, tenant_id);
