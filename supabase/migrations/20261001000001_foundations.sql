-- Source: quantspulse_supabase_schema.md §5.1 Foundations
-- =====================================================================
-- 5.1 Foundations: extensions, schemas, default privileges, enums
-- =====================================================================
create extension if not exists pgcrypto;
-- [QP change] 5.8 and the retention jobs call cron.schedule(); the spec never enabled it.
create extension if not exists pg_cron;

-- Private schema: secrets and helper functions. NEVER add it to
-- Dashboard → API → Exposed schemas.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role, supabase_auth_admin;

-- anon gets nothing by default; every grant below is explicit.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

create type public.tenant_type         as enum ('personal', 'organization');
create type public.tenant_role         as enum ('owner', 'admin', 'member');
create type public.plan_code           as enum ('basic', 'pro', 'pro_plus');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'expired', 'cancelled');
create type public.alert_condition     as enum ('above', 'below');
create type public.alert_status        as enum ('armed', 'triggered', 'disabled');
create type public.broker_code         as enum ('choice', 'zerodha', 'angelone', 'upstox', 'dhan', 'fyers', 'other');
create type public.ai_provider         as enum ('gemini', 'openai', 'anthropic', 'other');
create type public.exchange_code       as enum ('NSE', 'BSE');

-- Generic updated_at trigger
create or replace function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Active tenant from the JWT (set by the access token hook in 5.10)
create or replace function private.active_tenant_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif((select auth.jwt()) ->> 'app_tenant_id', '')::uuid
$$;
