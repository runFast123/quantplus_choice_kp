-- Source: quantspulse_supabase_schema.md §5.7 Shared Market Data (no user data)
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
