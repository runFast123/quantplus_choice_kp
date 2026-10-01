# QuantsPulse — Supabase Schema, RLS Policies & Multi-Tenant Data Isolation

**Prepared for:** Product / Engineering  **Date:** October 1, 2026  **Status:** Draft for review
**Replaces:** Firebase Auth, Firestore, Realtime Database, MongoDB `signals_latest`, and browser `localStorage` for user data

---

## 1. Purpose and Scope

This document defines the Supabase (Postgres) data model for QuantsPulse after the migration away from Firebase. It covers every table, the Row Level Security (RLS) policies that enforce access, the tenancy model that isolates data between customers, and the privacy controls for broker credentials, BYOK AI keys, and user financial data.

The SQL in Section 5 is written as one ordered migration. Run it on a staging project first, then run the isolation tests in Section 9 before production.

---

## 2. Tenancy Model

A **tenant** is the boundary that owns data and billing. There are two kinds.

A **personal tenant** is created automatically for every user at signup. For an individual retail user, the personal tenant is invisible — it is simply "their account".

An **organization tenant** represents a business using QuantsPulse with several people: an advisory firm, a broker partner, a white-label customer, or a trading desk. Users join it by invitation and hold a role of `owner`, `admin`, or `member`. A user can belong to several tenants and switches between them; the active tenant is carried in the JWT.

The core isolation rules are:

1. **Every row of user data carries both `tenant_id` and `user_id`.** RLS checks both, plus live membership in the tenant.
2. **Financial data is private to the user, even inside an organization.** A tenant admin can see who their members are and their plan status, but never their holdings, watchlists, alerts, broker connections, or AI keys. Sharing a portfolio with an advisor should be a future, explicit, consent-based feature — not a default.
3. **Membership is checked against the database on every query**, not only the JWT claim. Removing someone from a tenant takes effect immediately, even if their token hasn't expired.
4. **Secrets live in a non-exposed `private` schema** and are encrypted by the Node backend with a key that never lives in the database.
5. **Market data is global and contains no user data.** It is readable by every authenticated user and written only by pipelines.
6. **Platform admins are granted only by direct SQL.** No API path, client flag, or profile column can make someone an admin.

---

## 3. Access and Privacy Matrix

| Data | The user | Tenant owner/admin | Platform admin | Backend workers (service role) |
|---|---|---|---|---|
| Profile (name, phone) | Read / edit own | Name and email via directory function | Via admin dashboard | As needed |
| Portfolios, holdings, watchlists, alerts | Full control of own | **No access** | **No access** | Alert worker, broker sync |
| Broker connection status | Read / disconnect own | No access | No access | Read / write |
| Broker tokens, AI API keys (secrets) | Never readable; only "connected" and last 4 chars | No access | No access | Decrypt only at the moment of use |
| Subscription and payments | Read own | Plan, expiry, total paid | Full; writes via `admin_activate_plan` | Payment webhooks |
| Feature usage events | Read own | Per-user counts only (no symbols) | Same | Write |
| Audit log | No access | Own tenant's entries | Full (via backend) | Append only |
| Market data, signals, backtests | Read | Read | Read | Pipelines write |

---

## 4. Data Classification and Encryption

| Class | Examples | Protection |
|---|---|---|
| Public | Market candles, symbols, backtest ledgers, signals | RLS read for authenticated users |
| Personal | Email, name, phone, device hash, consents | RLS own-row only; phone shown to admins only where needed for payment follow-up |
| Financial-sensitive | Holdings, watchlists, alerts, payments, contract notes | RLS own-row + tenant; never in analytics or audit metadata |
| Secret | Broker access tokens, AI API keys | `private` schema, AES-256-GCM encrypted in Node, key held in a secret manager/KMS with `key_version` for rotation |

**Why encrypt in Node rather than Supabase Vault:** Vault keeps the encryption key inside the same project, so anyone with service-role database access could decrypt. Encrypting in the backend with an externally held key means a database dump alone exposes nothing usable.

---

## 5. Migration SQL

### 5.1 Foundations

```sql
-- =====================================================================
-- 5.1 Foundations: extensions, schemas, default privileges, enums
-- =====================================================================
create extension if not exists pgcrypto;

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
```

### 5.2 Tenancy

```sql
-- =====================================================================
-- 5.2 Tenants, memberships, invitations, platform admins
-- =====================================================================
create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  slug       text unique check (slug ~ '^[a-z0-9-]{3,48}$'),
  type       public.tenant_type not null default 'personal',
  status     text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.tenant_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_idx on public.tenant_members (user_id);

create table public.tenant_invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       text not null check (email = lower(email)),
  role        public.tenant_role not null default 'member' check (role <> 'owner'),
  token_hash  text not null unique,      -- SHA-256 of the emailed token; raw token never stored
  invited_by  uuid references auth.users(id) on delete set null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index tenant_invitations_tenant_idx on public.tenant_invitations (tenant_id);

-- Platform (super) admins. Only writable by direct SQL as the DB owner.
create table private.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note       text
);

-- Membership helpers. SECURITY DEFINER so RLS policies can call them
-- without recursive RLS checks on tenant_members.
create or replace function private.is_tenant_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant
      and m.user_id = (select auth.uid())
      and t.status = 'active'
  )
$$;

create or replace function private.has_tenant_role(p_tenant uuid, p_roles public.tenant_role[])
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
      and t.status = 'active'
  )
$$;

create or replace function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.platform_admins a where a.user_id = (select auth.uid()))
$$;
```

### 5.3 Identity, Plans and Billing

```sql
-- =====================================================================
-- 5.3 Profiles, devices, consents, plans, subscriptions, payments
-- =====================================================================
create table public.profiles (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  full_name         text check (char_length(full_name) <= 120),
  phone             text check (phone ~ '^\+?[0-9]{10,15}$'),
  avatar_url        text,
  default_tenant_id uuid references public.tenants(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
  -- NOTE: no is_admin / role column here, by design.
);

-- Single-active-device enforcement (replaces Firestore activeDeviceId)
create table public.user_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_hash  text not null,          -- SHA-256 of the fingerprint, never the raw value
  label        text,                   -- e.g. 'Chrome on Windows'
  is_active    boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (user_id, device_hash)
);
create unique index user_devices_one_active on public.user_devices (user_id) where is_active;

-- DPDP-style consent records
create table public.user_consents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  purpose      text not null check (purpose in
                 ('terms', 'privacy_policy', 'broker_data_access', 'ai_processing', 'marketing')),
  version      text not null,
  granted_at   timestamptz not null default now(),
  withdrawn_at timestamptz
);
create index user_consents_user_idx on public.user_consents (user_id);

-- Plan catalog. Limits/prices below are placeholders — confirm (see Section 10).
create table public.plans (
  code                  public.plan_code primary key,
  name                  text not null,
  price_paise_yearly    bigint not null check (price_paise_yearly >= 0),
  max_watchlist_symbols integer,       -- null = unlimited
  max_portfolio_symbols integer,       -- null = unlimited
  features              jsonb not null default '{}'::jsonb,
  is_active             boolean not null default true
);

insert into public.plans values
  ('basic',    'Basic',    0,       10,   0,
   '{"watchlist":true,"research":true}'),
  ('pro',      'Pro',      1000000, 15,   15,
   '{"watchlist":true,"research":true,"portfolio":true,"alerts":true,"scanning":true,"broker_connect":true,"ai_byok":true}'),
  ('pro_plus', 'Pro Plus', 1500000, null, null,
   '{"watchlist":true,"research":true,"portfolio":true,"alerts":true,"scanning":true,"broker_connect":true,"ai_byok":true}');

create table public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  user_id                 uuid not null references auth.users(id) on delete cascade,
  plan_code               public.plan_code not null references public.plans(code),
  status                  public.subscription_status not null,
  source                  text not null check (source in ('trial', 'gateway', 'manual', 'promo')),
  current_period_start    timestamptz not null default now(),
  current_period_end      timestamptz not null,
  gateway                 text,               -- 'razorpay' | 'cashfree'
  gateway_subscription_id text unique,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index subscriptions_one_live on public.subscriptions (user_id, tenant_id)
  where status in ('trialing', 'active', 'past_due');
create index subscriptions_owner_idx on public.subscriptions (user_id, tenant_id);

-- Payments survive account deletion (user_id set null) for tax/GST record keeping.
create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid references public.tenants(id) on delete set null,
  user_id            uuid references auth.users(id) on delete set null,
  subscription_id    uuid references public.subscriptions(id) on delete set null,
  amount_paise       bigint not null check (amount_paise >= 0),
  currency           text not null default 'INR',
  method             text not null check (method in ('gateway', 'upi', 'bank_transfer', 'cash', 'other')),
  status             text not null default 'captured'
                       check (status in ('pending', 'captured', 'failed', 'refunded')),
  gateway_payment_id text unique,
  external_reference text,                 -- UPI ref / bank UTR for manual payments
  recorded_by        uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index payments_owner_idx on public.payments (user_id, tenant_id);
```

### 5.4 User Financial Data

```sql
-- =====================================================================
-- 5.4 Broker connections, portfolios, holdings, watchlists, alerts
-- =====================================================================
create table public.broker_connections (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  broker                public.broker_code not null,
  broker_account_masked text,                  -- e.g. 'XXXX1234', never the full client ID
  scopes                text[] not null default '{read}',
  status                text not null default 'connected'
                          check (status in ('connected', 'expired', 'revoked', 'error')),
  token_expires_at      timestamptz,           -- most Indian broker tokens expire daily
  last_synced_at        timestamptz,
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, tenant_id, broker),
  unique (id, user_id, tenant_id)
);

create table private.broker_credentials (
  connection_id uuid primary key references public.broker_connections(id) on delete cascade,
  ciphertext    bytea not null,     -- AES-256-GCM, encrypted in the Node backend
  iv            bytea not null,
  auth_tag      bytea not null,
  key_version   smallint not null,  -- for key rotation
  updated_at    timestamptz not null default now()
);

create table public.portfolios (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null default private.active_tenant_id()
                         references public.tenants(id) on delete cascade,
  user_id              uuid not null default auth.uid()
                         references auth.users(id) on delete cascade,
  name                 text not null default 'My Portfolio' check (char_length(name) <= 80),
  source               text not null default 'manual' check (source in ('manual', 'broker', 'import')),
  broker_connection_id uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, user_id, tenant_id),
  -- Composite FK: a portfolio can only link to the SAME user's connection in the SAME tenant
  foreign key (broker_connection_id, user_id, tenant_id)
    references public.broker_connections (id, user_id, tenant_id)
    on delete set null (broker_connection_id)
);
create index portfolios_owner_idx on public.portfolios (user_id, tenant_id);

create table public.holdings (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default private.active_tenant_id(),
  user_id          uuid not null default auth.uid(),
  portfolio_id     uuid not null,
  symbol           text not null check (symbol ~ '^[A-Z0-9&\-\.]{1,20}$'),
  exchange         public.exchange_code not null default 'NSE',
  quantity         numeric(18,4) not null check (quantity >= 0),
  avg_price        numeric(18,4) not null check (avg_price >= 0),
  sector           text,
  source           text not null default 'manual' check (source in ('manual', 'broker', 'import')),
  broker_synced_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- A holding can only live in a portfolio owned by the same user in the same tenant
  foreign key (portfolio_id, user_id, tenant_id)
    references public.portfolios (id, user_id, tenant_id) on delete cascade,
  unique (portfolio_id, symbol, exchange)
);
create index holdings_owner_idx on public.holdings (user_id, tenant_id);

create table public.watchlists (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default private.active_tenant_id()
               references public.tenants(id) on delete cascade,
  user_id    uuid not null default auth.uid()
               references auth.users(id) on delete cascade,
  name       text not null default 'Market Radar' check (char_length(name) <= 80),
  created_at timestamptz not null default now(),
  unique (id, user_id, tenant_id)
);
create index watchlists_owner_idx on public.watchlists (user_id, tenant_id);

create table public.watchlist_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default private.active_tenant_id(),
  user_id      uuid not null default auth.uid(),
  watchlist_id uuid not null,
  symbol       text not null check (symbol ~ '^[A-Z0-9&\-\.]{1,20}$'),
  exchange     public.exchange_code not null default 'NSE',
  added_at     timestamptz not null default now(),
  foreign key (watchlist_id, user_id, tenant_id)
    references public.watchlists (id, user_id, tenant_id) on delete cascade,
  unique (watchlist_id, symbol, exchange)
);
create index watchlist_items_owner_idx on public.watchlist_items (user_id, tenant_id);

create table public.price_alerts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default private.active_tenant_id()
                    references public.tenants(id) on delete cascade,
  user_id         uuid not null default auth.uid()
                    references auth.users(id) on delete cascade,
  symbol          text not null check (symbol ~ '^[A-Z0-9&\-\.]{1,20}$'),
  exchange        public.exchange_code not null default 'NSE',
  condition       public.alert_condition not null,
  trigger_price   numeric(18,4) not null check (trigger_price > 0),
  origin          text not null default 'manual' check (origin in ('manual', 'quant_signal')),
  channels        text[] not null default '{in_app}',
  status          public.alert_status not null default 'armed',
  triggered_at    timestamptz,
  triggered_price numeric(18,4),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index price_alerts_owner_idx on public.price_alerts (user_id, tenant_id);
-- Used by the server-side alert worker to match incoming ticks
create index price_alerts_armed_idx on public.price_alerts (symbol, exchange) where status = 'armed';

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,                -- 'price_alert' | 'exit_signal' | 'plan_expiry' | 'broker_reauth'
  title      text not null,
  body       text,
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_owner_idx on public.notifications (user_id, tenant_id, created_at desc);
```

### 5.5 AI (BYOK) and Contract-Note Imports

```sql
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
```

### 5.6 Analytics and Audit

```sql
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
```

### 5.7 Shared Market Data (no user data)

```sql
-- =====================================================================
-- 5.7 Global market data. Replaces RTDB market_data / market_charts /
--     audit_results and Mongo signals_latest.
--     Live ticks are NOT stored here — keep them in memory/Redis.
--     Broker-sourced ticks are per-user and must never be written to
--     these shared tables (broker data-redistribution terms).
-- =====================================================================
create table public.market_symbols (
  symbol    text not null,
  exchange  public.exchange_code not null,
  name      text not null,
  isin      text,
  sector    text,
  is_active boolean not null default true,
  primary key (symbol, exchange)
);

create table public.market_candles (
  symbol   text not null,
  exchange public.exchange_code not null,
  interval text not null check (interval in ('1m', '5m', '15m', '1h', '1d')),
  ts       timestamptz not null,
  open     numeric(14,4) not null,
  high     numeric(14,4) not null,
  low      numeric(14,4) not null,
  close    numeric(14,4) not null,
  volume   bigint not null default 0,
  primary key (symbol, exchange, interval, ts)
) partition by range (ts);
-- Create monthly partitions (e.g. with pg_partman). Default catches the rest.
create table public.market_candles_default partition of public.market_candles default;

-- Backtest "audit ledger" per symbol (renamed to avoid confusion with audit_log)
create table public.backtest_ledgers (
  symbol      text not null,
  exchange    public.exchange_code not null,
  ledger      jsonb not null,         -- buys, dividends, splits, bonuses, running value
  roi_pct     numeric(10,4),
  computed_at timestamptz not null default now(),
  primary key (symbol, exchange)
);

create table public.trading_signals (
  id           bigint generated always as identity primary key,
  symbol       text not null,
  exchange     public.exchange_code not null,
  strategy     text not null,
  signal_type  text not null check (signal_type in ('buy', 'exit')),
  payload      jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now()
);
create index trading_signals_symbol_idx on public.trading_signals (symbol, exchange, generated_at desc);

create table public.rsi_events (
  symbol     text not null,
  exchange   public.exchange_code not null,
  ts         timestamptz not null,
  rsi        numeric(6,2) not null,
  event_type text not null,
  primary key (symbol, exchange, ts)
);
```

### 5.8 Entitlements and Plan Limits (enforced in the database)

```sql
-- =====================================================================
-- 5.8 Plan resolution, feature gates, symbol limits
-- =====================================================================
create or replace function private.effective_plan(p_user uuid, p_tenant uuid)
returns public.plan_code
language sql stable security definer set search_path = '' as $$
  select s.plan_code
  from public.subscriptions s
  where s.user_id = p_user
    and s.tenant_id = p_tenant
    and s.status in ('trialing', 'active')
    and s.current_period_end > now()
  order by s.current_period_end desc
  limit 1
$$;

-- Used inside RLS INSERT policies to gate features by plan
create or replace function private.plan_has_feature(p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (p.features ->> p_feature)::boolean
    from public.plans p
    where p.code = private.effective_plan((select auth.uid()), private.active_tenant_id())
  ), false)
$$;

-- Symbol-count limits per plan (watchlist and portfolio)
create or replace function private.enforce_symbol_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_plan  public.plan_code;
  v_limit integer;
  v_count integer;
begin
  -- Serialize concurrent inserts for this user+table so limits can't be raced
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || TG_TABLE_NAME, 0));

  v_plan := private.effective_plan(new.user_id, new.tenant_id);
  if v_plan is null then
    raise exception 'NO_ACTIVE_PLAN' using errcode = 'P0001';
  end if;

  if TG_TABLE_NAME = 'watchlist_items' then
    select p.max_watchlist_symbols into v_limit from public.plans p where p.code = v_plan;
    select count(*) into v_count
      from public.watchlist_items w
      where w.user_id = new.user_id and w.tenant_id = new.tenant_id;
  else
    select p.max_portfolio_symbols into v_limit from public.plans p where p.code = v_plan;
    select count(distinct (h.symbol, h.exchange)) into v_count
      from public.holdings h
      where h.user_id = new.user_id and h.tenant_id = new.tenant_id;
  end if;

  if v_limit is not null and v_count >= v_limit then
    raise exception 'PLAN_LIMIT_REACHED: plan % allows % symbols', v_plan, v_limit
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger trg_watchlist_limit before insert on public.watchlist_items
  for each row execute function private.enforce_symbol_limit();
create trigger trg_holdings_limit before insert on public.holdings
  for each row execute function private.enforce_symbol_limit();

-- Mark expired subscriptions (cosmetic: effective_plan already checks the date)
-- Requires the pg_cron extension.
select cron.schedule(
  'expire-subscriptions', '*/15 * * * *',
  $$ update public.subscriptions
       set status = 'expired', updated_at = now()
     where status in ('trialing', 'active') and current_period_end <= now() $$
);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['profiles', 'subscriptions', 'broker_connections', 'portfolios',
                           'holdings', 'price_alerts', 'ai_provider_keys'] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      'trg_' || t || '_updated_at', t);
  end loop;
end $$;
```

### 5.9 Row Level Security Policies

The standard ownership check used on every user-data table is:

> the row's `user_id` is the caller **and** the row's `tenant_id` is the caller's active tenant **and** the caller is still a live member of that tenant.

Wrapping `auth.uid()` and the helper calls in `(select …)` lets Postgres evaluate them once per query instead of once per row, which matters for large tables.

```sql
-- =====================================================================
-- 5.9 RLS
-- =====================================================================

-- ---------- Tenancy ----------
alter table public.tenants enable row level security;
create policy tenants_select_member on public.tenants
  for select to authenticated
  using (private.is_tenant_member(id));
create policy tenants_update_owner on public.tenants
  for update to authenticated
  using (private.has_tenant_role(id, '{owner}'))
  with check (private.has_tenant_role(id, '{owner}'));
-- Owners may rename only; status/type are platform-controlled.
revoke update on public.tenants from authenticated;
grant update (name, slug) on public.tenants to authenticated;

alter table public.tenant_members enable row level security;
-- Regular members see only their own membership; admins see the roster.
create policy members_select on public.tenant_members
  for select to authenticated
  using (user_id = (select auth.uid())
         or private.has_tenant_role(tenant_id, '{owner,admin}'));
create policy members_remove_by_admin on public.tenant_members
  for delete to authenticated
  using (private.has_tenant_role(tenant_id, '{owner,admin}') and role <> 'owner');
create policy members_leave on public.tenant_members
  for delete to authenticated
  using (user_id = (select auth.uid()) and role <> 'owner');
-- Inserts and role changes go through the backend (service role) so the
-- escalation rules (who may grant admin, last-owner protection) live in one place.
revoke insert, update on public.tenant_members from authenticated;

alter table public.tenant_invitations enable row level security;
create policy invitations_admin_select on public.tenant_invitations
  for select to authenticated
  using (private.has_tenant_role(tenant_id, '{owner,admin}'));
create policy invitations_admin_delete on public.tenant_invitations
  for delete to authenticated
  using (private.has_tenant_role(tenant_id, '{owner,admin}'));
revoke insert, update on public.tenant_invitations from authenticated;

-- ---------- Profiles (user-level, not tenant-scoped) ----------
alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- Column-level: default_tenant_id is changed only via the backend switch endpoint.
revoke update on public.profiles from authenticated;
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;

alter table public.user_devices enable row level security;
create policy devices_select_own on public.user_devices
  for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.user_devices from authenticated;

alter table public.user_consents enable row level security;
create policy consents_select_own on public.user_consents
  for select to authenticated using (user_id = (select auth.uid()));
create policy consents_insert_own on public.user_consents
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy consents_withdraw_own on public.user_consents
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke update on public.user_consents from authenticated;
grant update (withdrawn_at) on public.user_consents to authenticated;

-- ---------- Plan catalog (public pricing page can read it) ----------
alter table public.plans enable row level security;
grant select on public.plans to anon;
create policy plans_read on public.plans
  for select to anon, authenticated using (is_active);
revoke insert, update, delete on public.plans from authenticated;

-- ---------- User data with full CRUD + plan feature gate on insert ----------
do $$
declare
  r   record;
  own text := '(user_id = (select auth.uid())'
           || ' and tenant_id = (select private.active_tenant_id())'
           || ' and (select private.is_tenant_member(private.active_tenant_id())))';
begin
  for r in
    select key as tbl, value as feature
    from jsonb_each_text('{
      "portfolios":      "portfolio",
      "holdings":        "portfolio",
      "watchlists":      "watchlist",
      "watchlist_items": "watchlist",
      "price_alerts":    "alerts"
    }'::jsonb)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using %s',
                   r.tbl || '_select_own', r.tbl, own);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s and (select private.plan_has_feature(%L)))',
                   r.tbl || '_insert_own', r.tbl, own, r.feature);
    execute format('create policy %I on public.%I for update to authenticated using %s with check %s',
                   r.tbl || '_update_own', r.tbl, own, own);
    execute format('create policy %I on public.%I for delete to authenticated using %s',
                   r.tbl || '_delete_own', r.tbl, own);
  end loop;
end $$;

-- ---------- User data the client may only read (writes = backend) ----------
do $$
declare
  t   text;
  own text := '(user_id = (select auth.uid())'
           || ' and tenant_id = (select private.active_tenant_id())'
           || ' and (select private.is_tenant_member(private.active_tenant_id())))';
begin
  foreach t in array array['subscriptions', 'payments', 'notifications', 'broker_connections',
                           'ai_provider_keys', 'ai_usage_logs', 'contract_note_imports',
                           'activity_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using %s',
                   t || '_select_own', t, own);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;

  -- Users may disconnect a broker, delete an AI key, or clear notifications
  foreach t in array array['notifications', 'broker_connections', 'ai_provider_keys'] loop
    execute format('grant delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for delete to authenticated using %s',
                   t || '_delete_own', t, own);
  end loop;

  -- Mark notifications read
  execute 'grant update (read_at) on public.notifications to authenticated';
  execute format('create policy notifications_mark_read on public.notifications for update to authenticated using %s with check %s', own, own);
end $$;

-- ---------- Audit log ----------
alter table public.audit_log enable row level security;
create policy audit_log_tenant_admin_read on public.audit_log
  for select to authenticated
  using (private.has_tenant_role(tenant_id, '{owner,admin}'));
revoke insert, update, delete on public.audit_log from authenticated;

-- ---------- Shared market data: read-only for every signed-in user ----------
do $$
declare t text;
begin
  foreach t in array array['market_symbols', 'market_candles', 'backtest_ledgers',
                           'trading_signals', 'rsi_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)',
                   t || '_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;
-- Partitions are queried via the parent; block direct access to children.
alter table public.market_candles_default enable row level security;

-- ---------- Private schema: RLS on, no policies (service role only) ----------
alter table private.platform_admins    enable row level security;
alter table private.broker_credentials enable row level security;
alter table private.ai_key_secrets     enable row level security;
revoke all on all tables in schema private from anon, authenticated;
```

### 5.10 Signup Trigger and Custom Access Token Hook

```sql
-- =====================================================================
-- 5.10 New-user bootstrap + JWT tenant claim
-- =====================================================================
-- Every new user gets: personal tenant, owner membership, profile,
-- and the Basic plan free for 3 months.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  insert into public.tenants (name, type)
    values ('Personal workspace', 'personal')
    returning id into v_tenant;

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, new.id, 'owner');

  insert into public.profiles (user_id, default_tenant_id)
    values (new.id, v_tenant);

  insert into public.subscriptions
    (tenant_id, user_id, plan_code, status, source, current_period_start, current_period_end)
  values
    (v_tenant, new.id, 'basic', 'trialing', 'trial', now(), now() + interval '3 months');

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Custom Access Token Hook: adds app_tenant_id / app_tenant_role claims.
-- Enable in Dashboard → Authentication → Hooks.
-- Claims are for routing/UI convenience; RLS still re-checks membership.
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_user   uuid := (event ->> 'user_id')::uuid;
  v_tenant uuid;
  v_role   text;
  v_claims jsonb := event -> 'claims';
begin
  -- Prefer the user's chosen tenant; fall back to their oldest membership
  select m.tenant_id, m.role::text
    into v_tenant, v_role
  from public.tenant_members m
  left join public.profiles p on p.user_id = m.user_id
  where m.user_id = v_user
  order by (m.tenant_id = p.default_tenant_id) desc nulls last, m.created_at
  limit 1;

  if v_tenant is not null then
    v_claims := jsonb_set(v_claims, '{app_tenant_id}',   to_jsonb(v_tenant::text));
    v_claims := jsonb_set(v_claims, '{app_tenant_role}', to_jsonb(v_role));
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end $$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on public.profiles, public.tenant_members to supabase_auth_admin;
create policy auth_admin_read_profiles on public.profiles
  for select to supabase_auth_admin using (true);
create policy auth_admin_read_members on public.tenant_members
  for select to supabase_auth_admin using (true);
```

### 5.11 Admin and Tenant Functions (RPC)

```sql
-- =====================================================================
-- 5.11 Atomic plan activation, member directory, feature usage, export
-- =====================================================================

-- Replaces POST /api/admin/users/{id}/activate-plan's multi-write logic with
-- ONE transaction. Callable only by service_role; the Node backend passes
-- p_actor from the verified JWT, and the function re-checks admin status.
create or replace function public.admin_activate_plan(
  p_actor        uuid,
  p_user         uuid,
  p_tenant       uuid,
  p_plan         public.plan_code,
  p_months       integer,
  p_amount_paise bigint,
  p_method       text,
  p_reference    text default null
) returns public.subscriptions
language plpgsql security definer set search_path = '' as $$
declare
  v_sub public.subscriptions;
begin
  if not exists (select 1 from private.platform_admins a where a.user_id = p_actor) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenant_members m
                 where m.tenant_id = p_tenant and m.user_id = p_user) then
    raise exception 'USER_NOT_IN_TENANT';
  end if;
  if p_months not between 1 and 24 or p_amount_paise < 0 then
    raise exception 'INVALID_INPUT';
  end if;

  select * into v_sub
  from public.subscriptions s
  where s.user_id = p_user and s.tenant_id = p_tenant
    and s.status in ('trialing', 'active', 'past_due')
  for update;

  if found and v_sub.plan_code = p_plan and v_sub.status = 'active' then
    -- Same plan renewal: extend from the later of current end or now
    update public.subscriptions s
       set current_period_end = greatest(s.current_period_end, now()) + make_interval(months => p_months),
           source = 'manual'
     where s.id = v_sub.id
     returning * into v_sub;
  elsif found then
    -- Plan change or trial conversion: new period starts now
    update public.subscriptions s
       set plan_code = p_plan, status = 'active', source = 'manual',
           current_period_start = now(),
           current_period_end   = now() + make_interval(months => p_months)
     where s.id = v_sub.id
     returning * into v_sub;
  else
    insert into public.subscriptions
      (tenant_id, user_id, plan_code, status, source, current_period_start, current_period_end)
    values
      (p_tenant, p_user, p_plan, 'active', 'manual', now(), now() + make_interval(months => p_months))
    returning * into v_sub;
  end if;

  insert into public.payments
    (tenant_id, user_id, subscription_id, amount_paise, method, status, external_reference, recorded_by)
  values
    (p_tenant, p_user, v_sub.id, p_amount_paise, p_method, 'captured', p_reference, p_actor);

  insert into public.audit_log (tenant_id, actor_user_id, action, target_type, target_id, metadata)
  values (p_tenant, p_actor, 'plan.activated', 'user', p_user::text,
          jsonb_build_object('plan', p_plan, 'months', p_months,
                             'amount_paise', p_amount_paise, 'method', p_method));
  return v_sub;
end $$;

revoke execute on function public.admin_activate_plan from public, anon, authenticated;
grant  execute on function public.admin_activate_plan to service_role;

-- Member directory for tenant owners/admins (and platform admins).
-- Returns a fixed whitelist of columns — never holdings or secrets.
create or replace function public.tenant_member_directory(p_tenant uuid)
returns table (
  user_id          uuid,
  email            text,
  full_name        text,
  phone            text,
  role             public.tenant_role,
  plan             public.plan_code,
  plan_status      public.subscription_status,
  plan_expires_at  timestamptz,
  total_paid_paise bigint,
  last_sign_in_at  timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not (private.has_tenant_role(p_tenant, '{owner,admin}') or private.is_platform_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
  select m.user_id,
         u.email::text,
         p.full_name,
         p.phone,
         m.role,
         ls.plan_code,
         ls.status,
         ls.current_period_end,
         coalesce((select sum(pay.amount_paise)
                     from public.payments pay
                    where pay.user_id = m.user_id
                      and pay.tenant_id = p_tenant
                      and pay.status = 'captured'), 0)::bigint,
         u.last_sign_in_at
  from public.tenant_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  left join lateral (
    select s2.plan_code, s2.status, s2.current_period_end
    from public.subscriptions s2
    where s2.user_id = m.user_id and s2.tenant_id = p_tenant
    order by s2.current_period_end desc
    limit 1
  ) ls on true
  where m.tenant_id = p_tenant;
end $$;

revoke execute on function public.tenant_member_directory(uuid) from public, anon;
grant  execute on function public.tenant_member_directory(uuid) to authenticated;

-- "User-wise feature usage" for admins: counts only, no symbols or content.
create or replace function public.tenant_feature_usage(
  p_tenant uuid, p_from timestamptz, p_to timestamptz
)
returns table (user_id uuid, event_type text, events bigint, last_used_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not (private.has_tenant_role(p_tenant, '{owner,admin}') or private.is_platform_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
  select e.user_id, e.event_type, count(*), max(e.created_at)
  from public.activity_events e
  where e.tenant_id = p_tenant
    and e.created_at >= p_from
    and e.created_at <  p_to
  group by e.user_id, e.event_type
  order by 3 desc;
end $$;

revoke execute on function public.tenant_feature_usage(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function public.tenant_feature_usage(uuid, timestamptz, timestamptz) to authenticated;

-- Data-access right: user exports their own data. SECURITY INVOKER, so RLS
-- scopes every sub-select to the caller's own rows in the active tenant.
create or replace function public.export_my_data() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'exported_at',        now(),
    'profile',            (select to_jsonb(p) from public.profiles p),
    'consents',           (select coalesce(jsonb_agg(c), '[]'::jsonb) from public.user_consents c),
    'portfolios',         (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.portfolios x),
    'holdings',           (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.holdings x),
    'watchlists',         (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.watchlists x),
    'watchlist_items',    (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.watchlist_items x),
    'price_alerts',       (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.price_alerts x),
    'subscriptions',      (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.subscriptions x),
    'payments',           (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.payments x),
    'broker_connections', (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.broker_connections x),
    'ai_provider_keys',   (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.ai_provider_keys x)
  )
$$;

revoke execute on function public.export_my_data() from public, anon;
grant  execute on function public.export_my_data() to authenticated;
```

### 5.12 Storage (contract notes)

```sql
-- =====================================================================
-- 5.12 Private bucket; path = '{user_id}/{import_id}.{ext}'
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contract-notes', 'contract-notes', false, 10485760,
        array['application/pdf',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

create policy contract_notes_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'contract-notes'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy contract_notes_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'contract-notes'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy contract_notes_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'contract-notes'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
```

### 5.13 Least-Privilege Role for FastAPI

```sql
-- =====================================================================
-- 5.13 FastAPI reads market data only — it never sees user tables.
--      Set the password from your secret manager, not in source.
-- =====================================================================
create role analytics_reader login;
grant usage on schema public to analytics_reader;
grant select on public.market_symbols, public.market_candles, public.backtest_ledgers,
                public.trading_signals, public.rsi_events
  to analytics_reader;

do $$
declare t text;
begin
  foreach t in array array['market_symbols', 'market_candles', 'backtest_ledgers',
                           'trading_signals', 'rsi_events'] loop
    execute format('create policy %I on public.%I for select to analytics_reader using (true)',
                   t || '_analytics_read', t);
  end loop;
end $$;
-- Pipelines that WRITE market data use a separate role or the service role from a worker.
```

### 5.14 Final Verification

```sql
-- Must return ZERO rows: every public table has RLS enabled.
select c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and not c.relrowsecurity;

-- Must return ZERO rows: anon has no table privileges except plans.
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and table_name <> 'plans';
```

---

## 6. Backend Integration Rules (Node.js)

**Use the caller's JWT for user requests.** For every normal API call, create a per-request Supabase client carrying the user's token, so RLS enforces isolation even if a backend query forgets a filter.

```ts
// supabaseForRequest.ts — RLS applies with the caller's identity
import { createClient } from '@supabase/supabase-js';

export function supabaseForRequest(jwt: string) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

**Confine the service-role key.** Import the service-role client only in four modules: admin routes, payment webhooks, the broker-sync worker, and the alert worker. Every query in those modules must filter by both `user_id` and `tenant_id` explicitly. Add a lint rule or code-review check that blocks service-role imports anywhere else.

**Verify tokens server-side** using Supabase's JWKS endpoint (asymmetric signing keys) or `auth.getUser()` — never trust a decoded-but-unverified token.

**Tenant switching:** `POST /api/tenants/switch` verifies membership, updates `profiles.default_tenant_id` with the service role, then the client calls `supabase.auth.refreshSession()` so the hook issues a token with the new `app_tenant_id`.

**Secrets handling:** broker tokens and AI keys are encrypted in Node (AES-256-GCM) with a key from a secret manager or KMS. Decrypt only at the moment of a broker or LLM call, keep plaintext in memory only, and never log it. Responses to the client return only `status` and `key_last4`.

**Logging:** request logs must redact `Authorization` headers, broker tokens, AI keys, prompts, and contract-note contents.

**FastAPI** connects as `analytics_reader` and therefore cannot read any user table, even if compromised.

---

## 7. Account Deletion and Data Rights

Deletion is orchestrated by the backend in this order, so nothing is left behind:

1. Revoke broker tokens at each connected broker (where the broker API supports it).
2. Delete the user's files from the `contract-notes` bucket.
3. Delete the user's personal tenant (cascades its tenant-scoped rows).
4. Delete the user with `auth.admin.deleteUser()` — cascades profiles, devices, consents, memberships, and any remaining user-owned rows.
5. Payments are kept with `user_id` set to null for tax records; audit rows remain pseudonymous.
6. Write an `account.deleted` audit entry.

Other rights: **access/export** via `export_my_data()`; **correction** via profile updates; **consent withdrawal** via `user_consents.withdrawn_at` — withdrawing `broker_data_access` must trigger broker disconnection, and withdrawing `ai_processing` must disable AI features.

---

## 8. Retention

| Data | Retention |
|---|---|
| Contract-note files | Deleted immediately after parsing (max 24 hours) |
| Notifications | 90 days |
| Activity events, AI usage logs | 12 months |
| Broker credentials | Until disconnect or account deletion |
| Payments | As required for tax/GST records — confirm duration with your CA |
| Audit log | Per internal policy (e.g. 3 years) |

Implement with scheduled `pg_cron` jobs.

---

## 9. Isolation Test Plan

Run as SQL tests (pgTAP or plain transactions) in CI against a seeded database with **User A** and **User B** in different tenants, plus **User C** who is a member of an organization tenant where **Admin D** is admin.

```sql
-- Template: impersonate a user inside a rolled-back transaction
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '<USER_A_ID>', 'role', 'authenticated',
                    'app_tenant_id', '<TENANT_A_ID>')::text, true);

select count(*) from public.holdings where user_id = '<USER_B_ID>';   -- expect 0
insert into public.holdings (portfolio_id, symbol, quantity, avg_price, user_id, tenant_id)
values ('<USER_B_PORTFOLIO_ID>', 'TCS', 1, 100, '<USER_B_ID>', '<TENANT_B_ID>');  -- expect RLS error
rollback;
```

| # | Test | Expected |
|---|---|---|
| 1 | A reads B's holdings, watchlists, alerts | 0 rows |
| 2 | A inserts a row with B's `user_id` or `tenant_id` | RLS violation |
| 3 | A inserts a holding into B's portfolio using own `user_id` | Foreign key violation |
| 4 | A forges `app_tenant_id` = Tenant B in claims | 0 rows (membership check fails) |
| 5 | C removed from org tenant, old JWT still valid | 0 rows immediately |
| 6 | Admin D reads C's holdings | 0 rows |
| 7 | Admin D calls `tenant_member_directory` for their org | Whitelisted columns only |
| 8 | Admin D calls it for another tenant | `NOT_AUTHORIZED` |
| 9 | A updates own `profiles.default_tenant_id` | Permission denied |
| 10 | A selects from `private.broker_credentials` | Permission denied |
| 11 | Authenticated user calls `admin_activate_plan` | Permission denied |
| 12 | Basic user inserts 11th watchlist item | `PLAN_LIMIT_REACHED` |
| 13 | Basic user creates a price alert | RLS violation (feature gate) |
| 14 | Expired user inserts a watchlist item | `NO_ACTIVE_PLAN` |
| 15 | `analytics_reader` selects from `holdings` | Permission denied |
| 16 | A reads B's storage object path | Not found / denied |
| 17 | Update or delete on `audit_log` | Exception |
| 18 | Section 5.14 verification queries | 0 rows |

---

## 10. Open Decisions

1. **Plan limits.** The source document is ambiguous: Basic shows "10 stocks" while Pro shows "basic of 15 stocks". The seed values (Basic 10 watchlist / no portfolio; Pro 15 / 15; Pro Plus unlimited) need confirmation.
2. **Broker-synced holdings vs. plan limits.** Should a Pro user whose broker account holds 40 stocks see all 40, or only 15? The trigger currently enforces the limit for all sources.
3. **Pro Plus "free for now".** Implement as a `promo` subscription with an end date rather than a ₹0 price, so it can end cleanly.
4. **Organization billing.** Today subscriptions are per user per tenant. If organizations should pay for seats centrally, add a tenant-level subscription and seat count.
5. **Advisor access to client portfolios.** Not supported by design. If needed, add a `portfolio_shares` table with explicit, revocable, user-granted consent and audit logging.
6. **Phone visibility to tenant admins.** Currently returned by the directory for payment follow-up; consider masking it by default.
