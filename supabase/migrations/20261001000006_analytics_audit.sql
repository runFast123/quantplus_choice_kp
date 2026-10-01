-- Source: quantspulse_supabase_schema.md §5.6 Analytics and Audit
-- =====================================================================
-- 5.6 Feature-usage events and append-only audit log
-- =====================================================================
-- No symbol or free-text columns: usage analytics must not reveal what
-- a user holds or researches.
create table public.activity_events (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type ~ '^[a-z_]{3,48}$'),
  created_at timestamptz not null default now()
);
create index activity_events_tenant_idx on public.activity_events (tenant_id, created_at);

-- Intentionally no FKs: audit rows outlive deleted users/tenants and
-- become pseudonymous once the auth.users row is gone.
create table public.audit_log (
  id            bigint generated always as identity primary key,
  tenant_id     uuid,
  actor_user_id uuid,
  action        text not null,      -- 'plan.activated' | 'member.removed' | 'broker.connected' | 'account.deleted'
  target_type   text,
  target_id     text,
  metadata      jsonb not null default '{}'::jsonb,  -- NEVER tokens, keys, holdings or prompts
  ip_hash       text,
  created_at    timestamptz not null default now()
);
create index audit_log_tenant_idx on public.audit_log (tenant_id, created_at desc);

create or replace function private.audit_log_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger trg_audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();
