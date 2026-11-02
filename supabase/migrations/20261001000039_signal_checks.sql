-- Signal checks (ADR-038): two rules check their own record and tag a signal when the evidence says so.
--
-- Research: research/strategies/team/ (BRIEF.md, ROUND2.md, ROUND3.md, FINAL.md). Four researchers tested four ways to
-- make the rules adapt to the market (switching by market state, re-tuning settings each quarter, a health card per
-- rule, a probability checker), walk-forward 2021-26 on each year's 300 most traded stocks with a 0.5 % round-trip cost,
-- then confirmed the survivors on the stocks ranked 301-500. Nothing that hides or skips signals passed, and the rules
-- keep their settings. Two display-only checks passed; all four researchers agreed on them (design D***):
--   Strong trend check  a strong_trend buy is tagged 'weak' when the last 30 finished strong_trend trades in the same
--                       market weather lost money over their first 20 sessions (mean < 0 and t < -1). Finished =
--                       signalled more than 42 days before, so every grade is final. Fewer than 30 in that weather ->
--                       the rule's last 50; fewer than 20 -> no check. Grade = the 20-session move from the entry, or
--                       the stop's loss when the stop was hit within 20 sessions, minus the 0.5 % cost.
--   RSI dip check       a logistic regression on 25 numbers known at the setup's close (the stock's trend, momentum,
--                       volatility, volume, the market, and the rule's recent hit rate) gives the chance that the dip
--                       trade makes money after costs. It is refitted at each quarter start on finished trades only
--                       (signalled more than 28 days before), outside the database (pipelines/signal_checks), and is
--                       in force only while its forward-only calibration ranks its own past (slope > 1e-6). Top third
--                       of its training scores = 'high' (the only label the app tags), bottom third = 'low'.
-- Nothing is hidden: every signal is still listed and graded, and both checks' records are public
-- (view signal_check_record). A check is frozen once written: it says what was known on the signal day.

-- ------------------------------------------------------------------ 1. the checks
create table public.signal_checks (
  strategy    text not null,
  symbol      text not null,
  exchange    public.exchange_code not null,
  signal_day  date not null,             -- the close the rule fired on (for a dip: the close before the buy)
  label       text not null check (label in ('weak', 'ok', 'high', 'normal', 'low', 'none')),
  tagged      boolean generated always as (label in ('weak', 'high')) stored,   -- what the app shows a tag for
  score       numeric,                   -- trend: t of the recent grades; RSI dip: chance of making money (0-1)
  detail      jsonb not null default '{}'::jsonb,
  version     text not null,
  computed_at timestamptz not null default now(),
  primary key (strategy, symbol, exchange, signal_day)
);
create index signal_checks_day_idx on public.signal_checks (strategy, signal_day desc);
alter table public.signal_checks enable row level security;
create policy signal_checks_read on public.signal_checks for select to authenticated using (true);
revoke insert, update, delete on public.signal_checks from authenticated;
revoke all on public.signal_checks from anon;

-- ------------------------------------------------------------------ 2. Strong trend check
create or replace function private.refresh_trend_checks() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  with sig as (
    select distinct t.symbol, t.exchange, (t.generated_at at time zone 'Asia/Kolkata')::date as day
    from public.trading_signals t
    where t.strategy = 'strong_trend' and t.signal_type = 'buy'
      and not exists (select 1 from public.signal_checks c
                       where c.strategy = 'strong_trend' and c.symbol = t.symbol and c.exchange = t.exchange
                         and c.signal_day = (t.generated_at at time zone 'Asia/Kolkata')::date)
  ),
  graded as (
    select o.signal_day, o.symbol, o.weather,
           (case when o.stop_hit_20 then o.stop / o.entry_price - 1 else o.r20 end)::float8 - 0.005 as grade
    from public.signal_outcomes o
    where o.strategy = 'strong_trend' and o.side = 'long' and o.stop_hit_20 is not null
      and ((o.stop_hit_20 and o.stop is not null) or o.r20 is not null)
  ),
  pick as (
    select s.symbol, s.exchange, s.day, wx.state as weather, w.n as wn, w.mean as wmean, w.sd as wsd,
           a.n as an, a.mean as amean, a.sd as asd
    from sig s
    left join public.market_weather wx on wx.day = s.day
    cross join lateral (
      select count(*) as n, avg(x.grade) as mean, stddev_samp(x.grade) as sd
      from (select g.grade from graded g
             where wx.state is not null and g.weather = wx.state and g.signal_day < s.day - 42
             order by g.signal_day desc, g.symbol collate "C" desc limit 30) x
    ) w
    cross join lateral (
      select count(*) as n, avg(x.grade) as mean, stddev_samp(x.grade) as sd
      from (select g.grade from graded g where g.signal_day < s.day - 42
             order by g.signal_day desc, g.symbol collate "C" desc limit 50) x
    ) a
  ),
  card as (
    select p.symbol, p.exchange, p.day, p.weather,
           case when p.wn >= 30 then 'weather' else 'all' end as bucket,
           case when p.wn >= 30 then p.wn else p.an end as n,
           case when p.wn >= 30 then p.wmean else p.amean end as mean,
           case when p.wn >= 30 then p.wsd else p.asd end as sd
    from pick p
  ),
  scored as (
    select c.*,
           case when c.n < 20 then null
                when c.sd > 0 then c.mean / (c.sd / sqrt(c.n))
                when c.mean < 0 then '-Infinity'::float8 else 0 end as t
    from card c
  )
  insert into public.signal_checks (strategy, symbol, exchange, signal_day, label, score, detail, version)
  select 'strong_trend', s.symbol, s.exchange, s.day,
         case when s.n < 20 then 'none' when s.mean < 0 and s.t < -1 then 'weak' else 'ok' end,
         case when s.t is null or s.t = '-Infinity'::float8 then null else round(s.t::numeric, 3) end,
         jsonb_build_object('trades', s.n, 'bucket', s.bucket, 'weather', s.weather,
                            'mean_pct', round((100 * s.mean)::numeric, 2)),
         'trend_check/1'
  from scored s
  on conflict (strategy, symbol, exchange, signal_day) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function private.refresh_trend_checks() from public, anon, authenticated;

-- ------------------------------------------------------------------ 3. market context for the RSI dip check
-- Each year's 300 most traded stocks, chosen before the year starts (median close x volume over the 183 days before
-- 1 January, more than 100 sessions in that window, at least 300 stored sessions). 2019-2026 come from the research
-- (supabase/seed/ref_signal_checks.sql); later years are computed here once the window is stored.
create table public.market_pit_top (
  year     integer not null,
  symbol   text not null,
  exchange public.exchange_code not null default 'NSE',
  rank     integer not null check (rank between 1 and 300),
  primary key (year, symbol, exchange)
);
alter table public.market_pit_top enable row level security;
create policy market_pit_top_read on public.market_pit_top for select to authenticated using (true);
revoke insert, update, delete on public.market_pit_top from authenticated;
revoke all on public.market_pit_top from anon;

-- Per session: the share of the 500 largest companies (with at least 300 stored sessions) closing above their 50- and
-- 200-day averages, and how many RSI dip setups closed among that year's 300 most traded stocks.
create table public.market_breadth (
  day        date primary key,
  breadth50  numeric,
  breadth200 numeric,
  stocks     integer not null,
  rsi_setups integer,
  updated_at timestamptz not null default now()
);
alter table public.market_breadth enable row level security;
create policy market_breadth_read on public.market_breadth for select to authenticated using (true);
revoke insert, update, delete on public.market_breadth from authenticated;
revoke all on public.market_breadth from anon;

-- Per session and sector: the average 63-session return of its companies and the sector's rank among sectors (0-1].
create table public.market_sectors (
  day      date not null,
  sector   text not null,
  r63      numeric not null,
  rank_pct numeric not null,
  primary key (day, sector)
);
alter table public.market_sectors enable row level security;
create policy market_sectors_read on public.market_sectors for select to authenticated using (true);
revoke insert, update, delete on public.market_sectors from authenticated;
revoke all on public.market_sectors from anon;

create or replace function private.refresh_pit_top(p_year integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_lo   timestamptz := make_date(p_year, 1, 1)::timestamp at time zone 'Asia/Kolkata';
  v_rows integer;
begin
  if exists (select 1 from public.market_pit_top p where p.year = p_year) then return 0; end if;
  -- only once the whole window is stored: the Nifty has more than 100 sessions in it
  if (select count(*) from public.market_candles c
       where c.symbol = 'NIFTY' and c.exchange = 'NSE' and c.interval = '1d'
         and c.ts >= v_lo - interval '183 days' and c.ts < v_lo) <= 100 then
    return 0;
  end if;
  insert into public.market_pit_top (year, symbol, exchange, rank)
  select p_year, r.symbol, r.exchange, r.rk
  from (
    select w.symbol, w.exchange, row_number() over (order by w.tv desc, w.symbol collate "C") as rk
    from (
      select c.symbol, c.exchange, percentile_cont(0.5) within group (order by c.close * c.volume) as tv,
             count(*) as n
      from public.market_candles c
      join public.market_symbols s on s.symbol = c.symbol and s.exchange = c.exchange
      where s.is_active and s.segment = 'equity' and s.mcap_rank <= 500 and c.interval = '1d'
        and c.ts >= v_lo - interval '183 days' and c.ts < v_lo
        and (select count(*) from public.market_candles a
              where a.symbol = s.symbol and a.exchange = s.exchange and a.interval = '1d') >= 300
      group by c.symbol, c.exchange
    ) w
    where w.n > 100
  ) r
  where r.rk <= 300;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function private.refresh_pit_top(integer) from public, anon, authenticated;

-- A normal run rewrites the last 14 days; p_full rebuilds every stored session.
create or replace function private.refresh_market_breadth(p_full boolean default false) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_latest date;
  v_from   date;
  v_load   timestamptz;
  v_rows   integer;
  sym      record;
  v_ts     timestamptz[];
  v_c      numeric[];
  v_s200   numeric[];
  v_hits   date[] := '{}';
  v_day    date;
  n        integer;
  t        integer;
  d        float8;
  g        float8;
  ls       float8;
begin
  select (max(c.ts) at time zone 'Asia/Kolkata')::date into v_latest
    from public.market_candles c where c.symbol = 'NIFTY' and c.exchange = 'NSE' and c.interval = '1d';
  if v_latest is null then return 0; end if;
  v_from := case when p_full then date '1900-01-01' else v_latest - 14 end;
  -- the 200-day average needs 200 sessions before the first day written (420 calendar days are about 290 sessions)
  v_load := case when p_full then '-infinity'::timestamptz else (v_from - 420)::timestamp at time zone 'Asia/Kolkata' end;
  perform private.refresh_pit_top(extract(year from v_latest)::integer);

  with cov as (
    select s.symbol, s.exchange, coalesce(nullif(btrim(s.sector), ''), 'Other') as sector
    from public.market_symbols s
    where s.is_active and s.segment = 'equity' and s.mcap_rank <= 500
      and (select count(*) from public.market_candles c
            where c.symbol = s.symbol and c.exchange = s.exchange and c.interval = '1d') >= 300
  ),
  x as (
    select cov.sector, (c.ts at time zone 'Asia/Kolkata')::date as day, c.close,
           case when count(*) over w50 = 50 then avg(c.close) over w50 end as s50,
           case when count(*) over w200 = 200 then avg(c.close) over w200 end as s200,
           c.close / nullif(lag(c.close, 63) over o, 0) - 1 as r63
    from cov
    join public.market_candles c on c.symbol = cov.symbol and c.exchange = cov.exchange and c.interval = '1d'
    where c.ts >= v_load
    window o as (partition by c.symbol, c.exchange order by c.ts),
           w50 as (o rows 49 preceding), w200 as (o rows 199 preceding)
  ),
  sectors as (
    insert into public.market_sectors (day, sector, r63, rank_pct)
    select z.day, z.sector, round(z.r63, 6), round(cume_dist() over (partition by z.day order by z.r63)::numeric, 6)
    from (select x.day, x.sector, avg(x.r63) as r63 from x where x.r63 is not null and x.day >= v_from group by 1, 2) z
    on conflict (day, sector) do update set r63 = excluded.r63, rank_pct = excluded.rank_pct
      where (market_sectors.r63, market_sectors.rank_pct) is distinct from (excluded.r63, excluded.rank_pct)
    returning 1
  )
  insert into public.market_breadth (day, breadth50, breadth200, stocks, updated_at)
  select x.day,
         round(count(*) filter (where x.close > x.s50)::numeric / nullif(count(x.s50), 0), 6),
         round(count(*) filter (where x.close > x.s200)::numeric / nullif(count(x.s200), 0), 6),
         count(*), now()
  from x
  where x.day >= v_from
  group by x.day
  on conflict (day) do update
    set breadth50 = excluded.breadth50, breadth200 = excluded.breadth200, stocks = excluded.stocks, updated_at = now();
  get diagnostics v_rows = row_count;

  -- RSI dip setups (RSI(2) < 10 above the 200-day average, the research definition) among each year's top 300
  for sym in
    select distinct p.symbol, p.exchange from public.market_pit_top p
    where p.year between extract(year from greatest(v_from, date '1990-01-01'))::integer
                     and extract(year from v_latest)::integer
  loop
    select array_agg(x.ts order by x.ts), array_agg(x.close order by x.ts), array_agg(x.s200 order by x.ts)
      into v_ts, v_c, v_s200
      from (select c.ts, c.close, case when count(*) over w = 200 then avg(c.close) over w end as s200
              from public.market_candles c
             where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d' and c.ts >= v_load
            window w as (order by c.ts rows 199 preceding)) x;
    n := coalesce(cardinality(v_ts), 0);
    for t in 2..n loop
      d := (v_c[t] - v_c[t - 1])::float8;
      if t = 2 then g := greatest(d, 0); ls := greatest(-d, 0);
      else g := 0.5 * g + 0.5 * greatest(d, 0); ls := 0.5 * ls + 0.5 * greatest(-d, 0); end if;
      continue when t < 3 or ls <= 0 or v_s200[t] is null or v_c[t] <= v_s200[t];
      continue when 100 - 100 / (1 + g / ls) >= 10;
      v_day := (v_ts[t] at time zone 'Asia/Kolkata')::date;
      continue when v_day < v_from;
      if exists (select 1 from public.market_pit_top p
                  where p.year = extract(year from v_day)::integer and p.symbol = sym.symbol and p.exchange = sym.exchange) then
        v_hits := v_hits || v_day;
      end if;
    end loop;
  end loop;
  update public.market_breadth b
     set rsi_setups = case when exists (select 1 from public.market_pit_top p where p.year = extract(year from b.day)::integer)
                           then (select count(*) from unnest(v_hits) h where h = b.day) end
   where b.day >= v_from;
  return v_rows;
end $$;
revoke all on function private.refresh_market_breadth(boolean) from public, anon, authenticated;

-- ------------------------------------------------------------------ 4. RSI dip check
-- The model in force for each quarter (pipelines/signal_checks/tier_model.py, fit at the quarter start), and the
-- finished trades it learns from: the research record (2019-2026, seed) plus the live trades closed since.
create table public.signal_check_models (
  strategy   text not null,
  valid_from date not null check (valid_from = date_trunc('quarter', valid_from)::date),
  version    text not null,
  hr_rule    numeric,                    -- the quarter's value of the hr_rule feature
  model      jsonb not null,
  created_at timestamptz not null default now(),
  primary key (strategy, valid_from)
);
alter table public.signal_check_models enable row level security;
create policy signal_check_models_read on public.signal_check_models for select to authenticated using (true);
revoke insert, update, delete on public.signal_check_models from authenticated;
revoke all on public.signal_check_models from anon;

create table public.signal_check_training (
  strategy   text not null,
  symbol     text not null,
  signal_day date not null,
  features   float8[] not null,          -- private.rsi_check_features() order; null = missing
  net        float8 not null,            -- the trade's result after the 0.5 % round-trip cost (fraction)
  source     text not null check (source in ('research', 'live')),
  primary key (strategy, symbol, signal_day)
);
alter table public.signal_check_training enable row level security;
revoke all on public.signal_check_training from anon, authenticated;

create or replace function private.rsi_check_features() returns text[]
language sql immutable set search_path = '' as $$
  select array['d200', 'd50', 'd20', 'slope200', 'rsi14', 'rsi2', 'atrpct', 'volratio', 'rs_rank', 'r5', 'r20', 'r126',
               'dist_hi252', 'clv', 'gap', 'sector_rank', 'nifty_d200', 'nifty_r20', 'vix', 'vix_chg5', 'wx',
               'breadth50', 'breadth200', 'hr_rule', 'n_same_day']
$$;
revoke all on function private.rsi_check_features() from public, anon, authenticated;

-- Scores every RSI dip setup without a check: tomorrow's dip-buy levels and the filled buys (keyed by the setup's close).
-- Indicators follow research/strategies/backtest.py exactly (pandas ewm(alpha, adjust=False), rolling windows).
create or replace function private.refresh_rsi_checks() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  sym      record;
  v_day    date;
  v_ts     timestamptz[];
  v_o      numeric[];
  v_h      numeric[];
  v_l      numeric[];
  v_c      numeric[];
  v_v      numeric[];
  v_s20    numeric[];
  v_s50    numeric[];
  v_s200   numeric[];
  v_vol50  numeric[];
  v_hi     numeric[];
  v_rsi14  float8[];
  v_rsi2   float8[];
  v_atr    float8[];
  v_days   date[];
  n        integer;
  t        integer;
  i        integer;
  a        float8;
  tr       float8;
  d        float8;
  g14      float8;
  l14      float8;
  g2       float8;
  l2       float8;
  v_sector text;
  m        record;
  mk       record;
  v_rs     float8;
  v_secr   float8;
  v_in     boolean;
  v_f      jsonb;
  z        float8;
  p        float8;
  v_label  text;
  v_rows   integer := 0;
begin
  for sym in
    select x.symbol, x.exchange, array_agg(distinct x.day) as days
    from (
      select w.symbol, w.exchange, w.signal_day as day from public.signal_watch w where w.strategy = 'rsi_dip'
      union
      select t.symbol, t.exchange, (t.payload->>'signal_day')::date
      from public.trading_signals t
      where t.strategy = 'rsi_dip' and t.signal_type = 'buy' and t.payload->>'signal_day' ~ '^\d{4}-\d{2}-\d{2}$'
    ) x
    where not exists (select 1 from public.signal_checks c
                       where c.strategy = 'rsi_dip' and c.symbol = x.symbol and c.exchange = x.exchange
                         and c.signal_day = x.day)
      and exists (select 1 from public.signal_check_models mm where mm.strategy = 'rsi_dip' and mm.valid_from <= x.day)
    group by x.symbol, x.exchange
  loop
    select array_agg(x.ts order by x.ts), array_agg(x.open order by x.ts), array_agg(x.high order by x.ts),
           array_agg(x.low order by x.ts), array_agg(x.close order by x.ts), array_agg(x.volume order by x.ts),
           array_agg(x.s20 order by x.ts), array_agg(x.s50 order by x.ts), array_agg(x.s200 order by x.ts),
           array_agg(x.vol50 order by x.ts), array_agg(x.hi252 order by x.ts)
      into v_ts, v_o, v_h, v_l, v_c, v_v, v_s20, v_s50, v_s200, v_vol50, v_hi
      from (
        select c.ts, c.open, c.high, c.low, c.close, c.volume::numeric as volume,
               case when count(*) over w20 = 20 then avg(c.close) over w20 end as s20,
               case when count(*) over w50 = 50 then avg(c.close) over w50 end as s50,
               case when count(*) over w200 = 200 then avg(c.close) over w200 end as s200,
               case when count(*) over p50 = 50 then avg(c.volume) over p50 end as vol50,
               case when count(*) over p252 >= 200 then max(c.close) over p252 end as hi252
        from public.market_candles c
        where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
        window w20 as (order by c.ts rows 19 preceding), w50 as (order by c.ts rows 49 preceding),
               w200 as (order by c.ts rows 199 preceding),
               p50 as (order by c.ts rows between 50 preceding and 1 preceding),
               p252 as (order by c.ts rows between 252 preceding and 1 preceding)
      ) x;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 2;

    v_atr := array_fill(null::float8, array[n]);
    v_rsi14 := array_fill(null::float8, array[n]);
    v_rsi2 := array_fill(null::float8, array[n]);
    for t in 1..n loop
      tr := case when t = 1 then (v_h[t] - v_l[t])::float8
                 else greatest(v_h[t] - v_l[t], abs(v_h[t] - v_c[t - 1]), abs(v_l[t] - v_c[t - 1]))::float8 end;
      a := case when t = 1 then tr else a + (tr - a) / 14 end;
      if t >= 14 then v_atr[t] := a; end if;
      if t >= 2 then
        d := (v_c[t] - v_c[t - 1])::float8;
        if t = 2 then
          g14 := greatest(d, 0); l14 := greatest(-d, 0); g2 := g14; l2 := l14;
        else
          g14 := g14 + (greatest(d, 0) - g14) / 14; l14 := l14 + (greatest(-d, 0) - l14) / 14;
          g2 := 0.5 * g2 + 0.5 * greatest(d, 0); l2 := 0.5 * l2 + 0.5 * greatest(-d, 0);
        end if;
        if t >= 15 and l14 > 0 then v_rsi14[t] := 100 - 100 / (1 + g14 / l14); end if;
        if t >= 3 and l2 > 0 then v_rsi2[t] := 100 - 100 / (1 + g2 / l2); end if;
      end if;
    end loop;
    v_days := array(select (v_ts[k] at time zone 'Asia/Kolkata')::date from generate_series(1, n) k order by k);
    select coalesce(nullif(btrim(s.sector), ''), 'Other') into v_sector
      from public.market_symbols s where s.symbol = sym.symbol and s.exchange = sym.exchange;

    foreach v_day in array sym.days loop
      i := array_position(v_days, v_day);
      continue when i is null;
      select mm.valid_from, mm.hr_rule, mm.model into m
        from public.signal_check_models mm
       where mm.strategy = 'rsi_dip' and mm.valid_from <= v_day
       order by mm.valid_from desc limit 1;
      select w.* into mk from (
        select wx.day, wx.nifty / nullif(wx.nifty_sma200, 0) - 1 as nifty_d200,
               wx.nifty / nullif(lag(wx.nifty, 20) over o, 0) - 1 as nifty_r20,
               wx.vix, wx.vix / nullif(lag(wx.vix, 5) over o, 0) - 1 as vix_chg5,
               case wx.state when 'sunny' then 2 when 'mixed' then 1 when 'stormy' then 0 end as wx,
               b.breadth50, b.breadth200, b.rsi_setups
        from public.market_weather wx
        left join public.market_breadth b on b.day = wx.day
        where wx.day <= v_day and wx.day > v_day - 60
        window o as (order by wx.day)
      ) w where w.day = v_day;
      continue when mk.day is null or mk.rsi_setups is null;      -- the market context is not stored yet: next run
      select l.rs_pct into v_rs from public.market_leaders l
       where l.day = v_day and l.symbol = sym.symbol and l.exchange = sym.exchange;
      select ms.rank_pct into v_secr from public.market_sectors ms where ms.day = v_day and ms.sector = v_sector;
      v_in := exists (select 1 from public.market_pit_top pt
                       where pt.year = extract(year from v_day)::integer and pt.symbol = sym.symbol
                         and pt.exchange = sym.exchange);

      v_f := jsonb_strip_nulls(jsonb_build_object(
        'd200', v_c[i] / nullif(v_s200[i], 0) - 1,
        'd50', v_c[i] / nullif(v_s50[i], 0) - 1,
        'd20', v_c[i] / nullif(v_s20[i], 0) - 1,
        'slope200', case when i > 20 then v_s200[i] / nullif(v_s200[i - 20], 0) - 1 end,
        'rsi14', v_rsi14[i],
        'rsi2', v_rsi2[i],
        'atrpct', v_atr[i] / nullif(v_c[i], 0)::float8,
        'volratio', v_v[i] / nullif(v_vol50[i], 0),
        'rs_rank', v_rs,
        'r5', case when i > 5 then v_c[i] / nullif(v_c[i - 5], 0) - 1 end,
        'r20', case when i > 20 then v_c[i] / nullif(v_c[i - 20], 0) - 1 end,
        'r126', case when i > 126 then v_c[i] / nullif(v_c[i - 126], 0) - 1 end,
        'dist_hi252', v_c[i] / nullif(v_hi[i], 0) - 1,
        'clv', case when v_h[i] > v_l[i] then (v_c[i] - v_l[i]) / (v_h[i] - v_l[i]) else 0.5 end,
        'gap', case when i > 1 then v_o[i] / nullif(v_c[i - 1], 0) - 1 end,
        'sector_rank', v_secr,
        'nifty_d200', mk.nifty_d200,
        'nifty_r20', mk.nifty_r20,
        'vix', mk.vix,
        'vix_chg5', mk.vix_chg5,
        'wx', mk.wx,
        'breadth50', mk.breadth50,
        'breadth200', mk.breadth200,
        'hr_rule', m.hr_rule,
        'n_same_day', ln((1 + mk.rsi_setups + case when v_in then 0 else 1 end)::float8)));

      -- score: impute with the training median, standardise, logistic regression, then the quarter's calibration
      v_label := 'none';
      p := null;
      if (m.model->>'shown')::boolean and m.model ? 'coef' then
        select (m.model->>'intercept')::float8
               + sum((m.model->'coef'->>(k::integer - 1))::float8
                     * (coalesce((v_f->>e.name)::float8, (m.model->'median'->>(k::integer - 1))::float8)
                        - (m.model->'mean'->>(k::integer - 1))::float8)
                     / nullif((m.model->'sd'->>(k::integer - 1))::float8, 0))
          into z
          from jsonb_array_elements_text(m.model->'features') with ordinality as e(name, k);
        p := 1 / (1 + exp(least(700, -((m.model->>'platt_a')::float8 * z + (m.model->>'platt_b')::float8))));
        v_label := case when p >= (m.model->>'cut_hi')::float8 then 'high'
                        when p < (m.model->>'cut_lo')::float8 then 'low' else 'normal' end;
      end if;

      insert into public.signal_checks (strategy, symbol, exchange, signal_day, label, score, detail, version)
      values ('rsi_dip', sym.symbol, sym.exchange, v_day, v_label, round(p::numeric, 4),
              jsonb_build_object('features', v_f, 'model', m.valid_from, 'top300', v_in),
              coalesce(m.model->>'version', 'rsi_dip_tier'))
      on conflict (strategy, symbol, exchange, signal_day) do nothing;
      v_rows := v_rows + 1;
    end loop;
  end loop;
  return v_rows;
end $$;
revoke all on function private.refresh_rsi_checks() from public, anon, authenticated;

-- ------------------------------------------------------------------ 5. every buy with its result, and the public record
-- Each buy of the rules that store their result on the exit, with the result of the exit that closed it (a stock holds
-- one trade of a rule at a time, so the next row is its exit; open trades have none).
create view public.signal_trades
with (security_invoker = true) as
select x.strategy, x.symbol, x.exchange, x.signal_day,
       case when x.next_type = 'exit' and x.next_pnl ~ '^-?[0-9]+(\.[0-9]+)?$' then x.next_pnl::numeric end as result_pct,
       case when x.next_type = 'exit' then x.next_day end as exit_day
from (
  select t.strategy, t.symbol, t.exchange, t.signal_type,
         coalesce(case when t.payload->>'signal_day' ~ '^\d{4}-\d{2}-\d{2}$' then (t.payload->>'signal_day')::date end,
                  (t.generated_at at time zone 'Asia/Kolkata')::date) as signal_day,
         lead(t.signal_type) over w as next_type,
         lead(t.payload->>'pnl_pct') over w as next_pnl,
         ((lead(t.generated_at) over w) at time zone 'Asia/Kolkata')::date as next_day
  from public.trading_signals t
  where t.strategy in ('strong_trend', 'rsi_dip', 'kk_dip', 'sma_trend')
  window w as (partition by t.strategy, t.symbol, t.exchange order by t.generated_at)
) x
where x.signal_type = 'buy';
revoke all on public.signal_trades from anon, public;
grant select on public.signal_trades to authenticated;

-- Each check's live record by month and label. Made money = the rule's own result beat the 0.5 % round-trip cost.
create view public.signal_check_record
with (security_invoker = true) as
select c.strategy, date_trunc('month', c.signal_day)::date as month, c.label,
       count(*)                                          as signals,
       count(tr.result_pct)                              as trades,
       count(*) filter (where tr.result_pct > 0.5)       as made_money,
       round(avg(tr.result_pct - 0.5), 2)                as avg_result_pct
from public.signal_checks c
left join public.signal_trades tr
  on tr.strategy = c.strategy and tr.symbol = c.symbol and tr.exchange = c.exchange and tr.signal_day = c.signal_day
group by 1, 2, 3;
revoke all on public.signal_check_record from anon, public;
grant select on public.signal_check_record to authenticated;

-- Live RSI dip trades closed after the research record ends join the training set, with the features they were
-- scored on, when the stock was in that year's top 300 (the population the model was tested on).
create or replace function private.refresh_check_training() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  insert into public.signal_check_training (strategy, symbol, signal_day, features, net, source)
  select 'rsi_dip', tr.symbol, tr.signal_day,
         array(select (c.detail->'features'->>f.name)::float8
                 from unnest(private.rsi_check_features()) with ordinality as f(name, k) order by f.k),
         (tr.result_pct / 100 - 0.005)::float8, 'live'
  from public.signal_trades tr
  join public.signal_checks c
    on c.strategy = 'rsi_dip' and c.symbol = tr.symbol and c.exchange = tr.exchange and c.signal_day = tr.signal_day
  where tr.strategy = 'rsi_dip' and tr.result_pct is not null and (c.detail->>'top300')::boolean
    and c.detail ? 'features'
    and tr.signal_day > (select coalesce(max(s.signal_day), date '1900-01-01') from public.signal_check_training s
                          where s.strategy = 'rsi_dip' and s.source = 'research')
  on conflict (strategy, symbol, signal_day) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function private.refresh_check_training() from public, anon, authenticated;

-- ------------------------------------------------------------------ 6. service bridge
-- After every analytics batch of a run (it needs the whole day's signals). p_full rebuilds the market context.
create or replace function public.svc_refresh_signal_checks(p_full boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  v_out := jsonb_build_object('breadth', private.refresh_market_breadth(p_full));
  v_out := v_out || jsonb_build_object('trend', private.refresh_trend_checks());
  v_out := v_out || jsonb_build_object('rsi', private.refresh_rsi_checks());
  v_out := v_out || jsonb_build_object('training', private.refresh_check_training());
  return v_out;
end $$;
revoke execute on function public.svc_refresh_signal_checks(boolean) from public, anon, authenticated;
grant  execute on function public.svc_refresh_signal_checks(boolean) to service_role;

-- The quarterly refit (pipelines/signal_checks/retrain.py) reads the training set and stores the new model.
create or replace function public.svc_signal_check_training(p_strategy text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'features', to_jsonb(private.rsi_check_features()),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(t.symbol, t.signal_day, t.net, to_jsonb(t.features))
                                       order by t.signal_day, t.symbol)
                        from public.signal_check_training t where t.strategy = p_strategy), '[]'::jsonb))
$$;
revoke execute on function public.svc_signal_check_training(text) from public, anon, authenticated;
grant  execute on function public.svc_signal_check_training(text) to service_role;

create or replace function public.svc_put_signal_check_model(p_strategy text, p_valid_from date, p_hr_rule numeric,
                                                             p_model jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_strategy is distinct from 'rsi_dip' then raise exception 'unknown check: %', p_strategy; end if;
  if p_valid_from is distinct from date_trunc('quarter', p_valid_from)::date then
    raise exception 'valid_from must be a quarter start';
  end if;
  if p_model->'features' is distinct from to_jsonb(private.rsi_check_features()) then
    raise exception 'model features do not match private.rsi_check_features()';
  end if;
  insert into public.signal_check_models (strategy, valid_from, version, hr_rule, model)
  values (p_strategy, p_valid_from, coalesce(p_model->>'version', 'rsi_dip_tier'), p_hr_rule, p_model)
  on conflict (strategy, valid_from) do update
    set version = excluded.version, hr_rule = excluded.hr_rule, model = excluded.model, created_at = now();
end $$;
revoke execute on function public.svc_put_signal_check_model(text, date, numeric, jsonb) from public, anon, authenticated;
grant  execute on function public.svc_put_signal_check_model(text, date, numeric, jsonb) to service_role;

-- The pg_cron backstop runs the checks after the analytics too.
select cron.schedule('market-analytics', '25 12 * * 1-5',
  $$ select private.refresh_market_analytics(10); select private.refresh_setups();
     select private.refresh_market_weather(); select private.refresh_strong_trend(); select private.refresh_sma_trend();
     select private.refresh_dip_rules(); select private.grade_signals(); select public.svc_refresh_signal_checks(); $$);

-- Strong trend checks need no model: write them for every stored signal now. The RSI dip check starts once the
-- reference seed (supabase/seed/ref_signal_checks.sql) has stored the research models, lists and training set.
select private.refresh_trend_checks();
