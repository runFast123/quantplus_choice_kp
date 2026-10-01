-- Source: quantspulse_supabase_schema.md §5.4 User Financial Data
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
  -- [QP change] user_id/tenant_id are part of the unique key. With the spec's
  -- (parent, symbol, exchange) key, Postgres checks uniqueness before the ownership FK,
  -- so inserting into someone else's parent returned 'duplicate key' vs 'foreign key' —
  -- an oracle for what another user holds. Same semantics, since the FK pins both columns.
  unique (portfolio_id, user_id, tenant_id, symbol, exchange)
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
  -- [QP change] user_id/tenant_id are part of the unique key. With the spec's
  -- (parent, symbol, exchange) key, Postgres checks uniqueness before the ownership FK,
  -- so inserting into someone else's parent returned 'duplicate key' vs 'foreign key' —
  -- an oracle for what another user holds. Same semantics, since the FK pins both columns.
  unique (watchlist_id, user_id, tenant_id, symbol, exchange)
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
