-- =====================================================================
-- DEV / STAGING ONLY — SYNTHETIC market data.
-- Prices are a deterministic random walk, NOT real quotes. In production
-- pipelines/eod (yfinance, service role) owns these tables — never run
-- this against production. Safe to re-run: it clears and rebuilds the
-- shared market tables. Needs migration 24 (refresh_market_analytics).
-- =====================================================================
begin;

truncate public.trading_signals, public.rsi_events, public.backtest_ledgers,
         public.market_candles, public.market_symbols restart identity cascade;
-- cascade also clears symbol-linked news, aliases and research notes; ref_news_aliases.sql re-adds aliases.
-- The universe is reference data (ref_market_symbols.sql); a copy is inlined here because seeds run
-- alphabetically and this file must stand alone. Keep the two lists in sync.
insert into public.market_symbols (symbol, exchange, name, sector, is_active, history_days) values
  ('RELIANCE',   'NSE', 'Reliance Industries',             'Energy',         true, 760),
  ('TCS',        'NSE', 'Tata Consultancy Services',       'IT',             true, 760),
  ('HDFCBANK',   'NSE', 'HDFC Bank',                       'Banking',        true, 760),
  ('INFY',       'NSE', 'Infosys',                         'IT',             true, 760),
  ('ICICIBANK',  'NSE', 'ICICI Bank',                      'Banking',        true, 760),
  ('HINDUNILVR', 'NSE', 'Hindustan Unilever',              'FMCG',           true, 760),
  ('ITC',        'NSE', 'ITC',                             'FMCG',           true, 760),
  ('SBIN',       'NSE', 'State Bank of India',             'Banking',        true, 760),
  ('BHARTIARTL', 'NSE', 'Bharti Airtel',                   'Telecom',        true, 760),
  ('KOTAKBANK',  'NSE', 'Kotak Mahindra Bank',             'Banking',        true, 760),
  ('LT',         'NSE', 'Larsen & Toubro',                 'Capital Goods',  true, 760),
  ('AXISBANK',   'NSE', 'Axis Bank',                       'Banking',        true, 760),
  ('ASIANPAINT', 'NSE', 'Asian Paints',                    'Consumer',       true, 760),
  ('MARUTI',     'NSE', 'Maruti Suzuki India',             'Auto',           true, 760),
  ('SUNPHARMA',  'NSE', 'Sun Pharmaceutical',              'Pharma',         true, 760),
  ('TITAN',      'NSE', 'Titan Company',                   'Consumer',       true, 760),
  ('BAJFINANCE', 'NSE', 'Bajaj Finance',                   'Financials',     true, 760),
  ('HCLTECH',    'NSE', 'HCL Technologies',                'IT',             true, 760),
  ('WIPRO',      'NSE', 'Wipro',                           'IT',             true, 760),
  ('ULTRACEMCO', 'NSE', 'UltraTech Cement',                'Materials',      true, 760),
  ('NESTLEIND',  'NSE', 'Nestle India',                    'FMCG',           true, 760),
  ('ONGC',       'NSE', 'Oil & Natural Gas Corp',          'Energy',         true, 760),
  ('NTPC',       'NSE', 'NTPC',                            'Utilities',      true, 760),
  ('POWERGRID',  'NSE', 'Power Grid Corp',                 'Utilities',      true, 760),
  ('TATAMOTORS', 'NSE', 'Tata Motors (pre-demerger)',      'Auto',           false, 760),
  ('TMPV',       'NSE', 'Tata Motors Passenger Vehicles',  'Auto',           true, 760),
  ('TMCV',       'NSE', 'Tata Motors',                     'Auto',           true, 760),
  ('TATASTEEL',  'NSE', 'Tata Steel',                      'Metals',         true, 760),
  ('JSWSTEEL',   'NSE', 'JSW Steel',                       'Metals',         true, 760),
  ('M&M',        'NSE', 'Mahindra & Mahindra',             'Auto',           true, 760),
  ('ADANIPORTS', 'NSE', 'Adani Ports & SEZ',               'Infrastructure', true, 760),
  ('COALINDIA',  'NSE', 'Coal India',                      'Energy',         true, 760),
  ('DRREDDY',    'NSE', 'Dr. Reddy''s Laboratories',       'Pharma',         true, 760),
  ('CIPLA',      'NSE', 'Cipla',                           'Pharma',         true, 760),
  ('TECHM',      'NSE', 'Tech Mahindra',                   'IT',             true, 760),
  ('HDFCLIFE',   'NSE', 'HDFC Life Insurance',             'Financials',     true, 760),
  ('BAJAJ-AUTO', 'NSE', 'Bajaj Auto',                      'Auto',           true, 760),
  ('EICHERMOT',  'NSE', 'Eicher Motors',                   'Auto',           true, 760),
  ('GRASIM',     'NSE', 'Grasim Industries',               'Materials',      true, 760),
  ('HEROMOTOCO', 'NSE', 'Hero MotoCorp',                   'Auto',           true, 760),
  ('BRITANNIA',  'NSE', 'Britannia Industries',            'FMCG',           true, 760),
  ('APOLLOHOSP', 'NSE', 'Apollo Hospitals',                'Healthcare',     true, 760),
  ('DMART',      'NSE', 'Avenue Supermarts',               'Retail',         true, 760),
  ('IRCTC',      'NSE', 'Indian Railway Catering',         'Services',       true, 760)
on conflict (symbol, exchange) do update
  -- names/sectors of existing rows belong to the universe sync (pipelines/eod/universe.py)
  set is_active = excluded.is_active, history_days = 760;

update public.market_symbols
   set status_note = 'Tata Motors demerged on 14 Oct 2025 into Tata Motors Passenger Vehicles (TMPV, incl. JLR) and Tata Motors (TMCV, commercial vehicles). TATAMOTORS no longer trades.',
       successors = '{TMPV,TMCV}'
 where symbol = 'TATAMOTORS' and exchange = 'NSE';


-- ---------- Daily candles: ~2 years of weekdays, IST close (10:00 UTC) ----------
select setseed(0.4217);

create temp table _walk on commit drop as
with days as (
  select d::date as day
  from generate_series(current_date - 730, current_date - 1, interval '1 day') d
  where extract(isodow from d) < 6
),
params as (
  select symbol, exchange,
         -- per-symbol starting price, drift and volatility derived from the name
         (200 + (abs(hashtext(symbol)) % 4800))::numeric          as base,
         ((abs(hashtext(symbol || 'd')) % 9) - 3) / 10000.0        as drift,
         (0.010 + (abs(hashtext(symbol || 'v')) % 12) / 1000.0)    as vol
  from public.market_symbols
),
shocks as (
  select p.symbol, p.exchange, p.base, p.vol, d.day,
         (p.drift + p.vol * (random() + random() + random() - 1.5) * 1.4)::numeric as ret,
         random()::numeric as r1, random()::numeric as r2,
         random()::numeric as r3, random()::numeric as r4
  from params p cross join days d
)
select symbol, exchange, day, vol, r1, r2, r3, r4,
       round(base * exp(sum(ret) over (partition by symbol, exchange order by day)), 2) as close
from shocks;

insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select symbol, exchange, '1d',
       (day + time '10:00') at time zone 'UTC',
       o, round(greatest(o, close) * (1 + vol * r2 * 0.6), 2),
          round(least(o, close)   * (1 - vol * r3 * 0.6), 2),
       close,
       (200000 + r4 * 4800000)::bigint
from (
  select w.*,
         round(coalesce(lag(close) over (partition by symbol, exchange order by day), close)
               * (1 + vol * (r1 - 0.5) * 0.5), 2) as o
  from _walk w
) x;

-- ---------- RSI, SMA, signals, SIP backtests: same code as real data ----------
select private.refresh_market_analytics(100000);

commit;
