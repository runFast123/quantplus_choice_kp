-- =====================================================================
-- DEV / STAGING ONLY — SYNTHETIC market data.
-- Prices are a deterministic random walk, NOT real quotes. In production
-- the market pipelines (service role) own these tables (spec §5.7).
-- Safe to re-run: it clears and rebuilds the shared market tables.
-- =====================================================================
begin;

truncate public.trading_signals, public.rsi_events, public.backtest_ledgers,
         public.market_candles, public.market_symbols restart identity;

insert into public.market_symbols (symbol, exchange, name, sector) values
  ('RELIANCE',   'NSE', 'Reliance Industries',          'Energy'),
  ('TCS',        'NSE', 'Tata Consultancy Services',    'IT'),
  ('HDFCBANK',   'NSE', 'HDFC Bank',                    'Banking'),
  ('INFY',       'NSE', 'Infosys',                      'IT'),
  ('ICICIBANK',  'NSE', 'ICICI Bank',                   'Banking'),
  ('HINDUNILVR', 'NSE', 'Hindustan Unilever',           'FMCG'),
  ('ITC',        'NSE', 'ITC',                          'FMCG'),
  ('SBIN',       'NSE', 'State Bank of India',          'Banking'),
  ('BHARTIARTL', 'NSE', 'Bharti Airtel',                'Telecom'),
  ('KOTAKBANK',  'NSE', 'Kotak Mahindra Bank',          'Banking'),
  ('LT',         'NSE', 'Larsen & Toubro',              'Capital Goods'),
  ('AXISBANK',   'NSE', 'Axis Bank',                    'Banking'),
  ('ASIANPAINT', 'NSE', 'Asian Paints',                 'Consumer'),
  ('MARUTI',     'NSE', 'Maruti Suzuki India',          'Auto'),
  ('SUNPHARMA',  'NSE', 'Sun Pharmaceutical',           'Pharma'),
  ('TITAN',      'NSE', 'Titan Company',                'Consumer'),
  ('BAJFINANCE', 'NSE', 'Bajaj Finance',                'Financials'),
  ('HCLTECH',    'NSE', 'HCL Technologies',             'IT'),
  ('WIPRO',      'NSE', 'Wipro',                        'IT'),
  ('ULTRACEMCO', 'NSE', 'UltraTech Cement',             'Materials'),
  ('NESTLEIND',  'NSE', 'Nestle India',                 'FMCG'),
  ('ONGC',       'NSE', 'Oil & Natural Gas Corp',       'Energy'),
  ('NTPC',       'NSE', 'NTPC',                         'Utilities'),
  ('POWERGRID',  'NSE', 'Power Grid Corp',              'Utilities'),
  ('TATAMOTORS', 'NSE', 'Tata Motors',                  'Auto'),
  ('TATASTEEL',  'NSE', 'Tata Steel',                   'Metals'),
  ('JSWSTEEL',   'NSE', 'JSW Steel',                    'Metals'),
  ('M&M',        'NSE', 'Mahindra & Mahindra',          'Auto'),
  ('ADANIPORTS', 'NSE', 'Adani Ports & SEZ',            'Infrastructure'),
  ('COALINDIA',  'NSE', 'Coal India',                   'Energy'),
  ('DRREDDY',    'NSE', 'Dr. Reddy''s Laboratories',    'Pharma'),
  ('CIPLA',      'NSE', 'Cipla',                        'Pharma'),
  ('TECHM',      'NSE', 'Tech Mahindra',                'IT'),
  ('HDFCLIFE',   'NSE', 'HDFC Life Insurance',          'Financials'),
  ('BAJAJ-AUTO', 'NSE', 'Bajaj Auto',                   'Auto'),
  ('EICHERMOT',  'NSE', 'Eicher Motors',                'Auto'),
  ('GRASIM',     'NSE', 'Grasim Industries',            'Materials'),
  ('HEROMOTOCO', 'NSE', 'Hero MotoCorp',                'Auto'),
  ('BRITANNIA',  'NSE', 'Britannia Industries',         'FMCG'),
  ('APOLLOHOSP', 'NSE', 'Apollo Hospitals',             'Healthcare'),
  ('DMART',      'NSE', 'Avenue Supermarts',            'Retail'),
  ('IRCTC',      'NSE', 'Indian Railway Catering',      'Services');

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

-- ---------- RSI(14), SMA(20/50) ----------
create temp table _ind on commit drop as
with base as (
  select symbol, exchange, ts, close,
         close - lag(close) over w as diff
  from public.market_candles
  where interval = '1d'
  window w as (partition by symbol, exchange order by ts)
),
avgs as (
  select *,
         avg(greatest(diff, 0)) over w14 as avg_gain,
         avg(greatest(-diff, 0)) over w14 as avg_loss,
         avg(close) over w20 as sma20,
         avg(close) over w50 as sma50,
         row_number() over (partition by symbol, exchange order by ts) as n
  from base
  window w14 as (partition by symbol, exchange order by ts rows between 13 preceding and current row),
         w20 as (partition by symbol, exchange order by ts rows between 19 preceding and current row),
         w50 as (partition by symbol, exchange order by ts rows between 49 preceding and current row)
)
select symbol, exchange, ts, close, n, sma20, sma50,
       case when n < 15 then null
            when avg_loss = 0 then 100
            else round(100 - 100 / (1 + avg_gain / avg_loss), 2) end as rsi
from avgs;

create temp table _ind2 on commit drop as
select i.*,
       lag(rsi)   over w as prev_rsi,
       lag(sma20) over w as prev_sma20,
       lag(sma50) over w as prev_sma50
from _ind i
window w as (partition by symbol, exchange order by ts);

insert into public.rsi_events (symbol, exchange, ts, rsi, event_type)
select symbol, exchange, ts, rsi,
       case when rsi < 30 and coalesce(prev_rsi, 50) >= 30 then 'oversold_cross'
            when rsi > 70 and coalesce(prev_rsi, 50) <= 70 then 'overbought_cross'
            else 'daily' end
from _ind2
where rsi is not null and ts > now() - interval '180 days';

-- ---------- Signals: SMA 20/50 cross + RSI reversal ----------
insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
select symbol, exchange, 'sma_20_50_cross',
       case when sma20 > sma50 then 'buy' else 'exit' end,
       jsonb_build_object('close', close, 'sma20', round(sma20, 2), 'sma50', round(sma50, 2),
                          'stop',   round(close * 0.93, 2),
                          'target', round(close * 1.12, 2)),
       ts + interval '15 minutes'
from _ind2
where n > 50
  and ((sma20 > sma50 and prev_sma20 <= prev_sma50) or (sma20 < sma50 and prev_sma20 >= prev_sma50));

insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
select symbol, exchange, 'rsi_reversal',
       case when prev_rsi < 30 then 'buy' else 'exit' end,
       jsonb_build_object('close', close, 'rsi', rsi, 'prev_rsi', prev_rsi,
                          'stop',   round(close * 0.95, 2),
                          'target', round(close * 1.08, 2)),
       ts + interval '20 minutes'
from _ind2
where (prev_rsi < 30 and rsi >= 30) or (prev_rsi > 70 and rsi <= 70);

-- ---------- Backtest ledger: monthly ₹10,000 SIP from the first candle ----------
insert into public.backtest_ledgers (symbol, exchange, ledger, roi_pct, computed_at)
with firsts as (
  select distinct on (symbol, exchange, date_trunc('month', ts))
         symbol, exchange, ts, close
  from public.market_candles
  where interval = '1d'
  order by symbol, exchange, date_trunc('month', ts), ts
),
buys as (
  select symbol, exchange, ts, close,
         round(10000 / close, 4) as units,
         sum(round(10000 / close, 4)) over w as running_units,
         count(*) over w * 10000 as invested
  from firsts
  window w as (partition by symbol, exchange order by ts)
),
lastp as (
  select distinct on (symbol, exchange) symbol, exchange, close as last_close
  from public.market_candles where interval = '1d'
  order by symbol, exchange, ts desc
)
select b.symbol, b.exchange,
       jsonb_build_object(
         'strategy', 'monthly_sip',
         'installment', 10000,
         'entries', jsonb_agg(jsonb_build_object(
             'date', to_char(b.ts at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
             'type', 'buy', 'price', b.close, 'units', b.units,
             'running_units', b.running_units, 'invested', b.invested,
             'value', round(b.running_units * b.close, 2)) order by b.ts),
         'invested', max(b.invested),
         'final_value', round(max(b.running_units) * l.last_close, 2)),
       round((max(b.running_units) * l.last_close - max(b.invested)) / max(b.invested) * 100, 4),
       now()
from buys b join lastp l using (symbol, exchange)
group by b.symbol, b.exchange, l.last_close;

commit;
