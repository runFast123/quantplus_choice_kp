-- Source: quantspulse_supabase_schema.md §5.3 Identity, Plans and Billing
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
