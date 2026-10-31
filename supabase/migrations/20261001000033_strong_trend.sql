-- Strong trend signal, market weather and the signal grader (ADR-035).
--
-- 1. public.market_weather: one row per session, from the Nifty 50 and India VIX candles.
--      stormy  Nifty below its 200-day average with the 50-day below the 200-day, OR India VIX above 22
--      sunny   Nifty above its 200-day average with the 50-day above the 200-day, AND VIX at or below 22
--      mixed   everything else (null until the Nifty has 200 sessions)
-- 2. strategy 'strong_trend' (the 500 largest companies, mcap_rank <= 500):
--      buy   close above the highest close of the previous 252 sessions, volume at least 2x the average of
--            the previous 50 sessions, close above its 50-day average, weather 'sunny' that day.
--            Payload: stop = close - 4 x ATR14 (simple 14-day average true range), review after 60 sessions.
--      exit  the first session whose low reaches the stop (filled at the stop, or the open if it gapped
--            below), otherwise the close of the 60th session after entry. Entry = the next session's open.
--      One open trade per stock: no new buy until the last one has an exit. Tested on 2019-2026 prices
--      (research/strategies, docs/DECISIONS.md ADR-035); a signal is research, never advice.
-- 3. public.signal_outcomes: every entry signal of every strategy, graded from stored candles after 5, 20
--      and 60 sessions (session 1 = the entry day), against the Nifty 500 over the same sessions. Nothing
--      is filtered out; a signal is graded as soon as its candles exist. public.strategy_scorecard sums it up.
-- All of it is derived only from market_candles (no user data), readable by signed-in users like
-- trading_signals, written only by the service role through the pipeline wrapper.

-- ------------------------------------------------------------------ 1. market weather
create table public.market_weather (
  day          date primary key,
  nifty        numeric not null,
  nifty_sma50  numeric,
  nifty_sma200 numeric,
  vix          numeric,
  state        text check (state in ('sunny', 'mixed', 'stormy')),
  updated_at   timestamptz not null default now()
);
alter table public.market_weather enable row level security;
create policy market_weather_read on public.market_weather for select to authenticated using (true);
revoke insert, update, delete on public.market_weather from authenticated;
revoke all on public.market_weather from anon;

create or replace function private.refresh_market_weather() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  insert into public.market_weather (day, nifty, nifty_sma50, nifty_sma200, vix, state, updated_at)
  select d.day, d.close, d.s50, d.s200, v.close,
         case when d.s200 is null or d.s50 is null then null
              when (d.close < d.s200 and d.s50 < d.s200) or v.close > 22 then 'stormy'
              when d.close > d.s200 and d.s50 > d.s200 then 'sunny'
              else 'mixed' end,
         now()
  from (
    select c.ts, (c.ts at time zone 'Asia/Kolkata')::date as day, c.close,
           case when count(*) over w50 = 50 then avg(c.close) over w50 end as s50,
           case when count(*) over w200 = 200 then avg(c.close) over w200 end as s200
    from public.market_candles c
    where c.symbol = 'NIFTY' and c.exchange = 'NSE' and c.interval = '1d'
    window w50 as (order by c.ts rows 49 preceding), w200 as (order by c.ts rows 199 preceding)
  ) d
  -- the latest VIX close on or before the day (a missing VIX day carries the last one, at most a week)
  left join lateral (
    select x.close from public.market_candles x
    where x.symbol = 'INDIAVIX' and x.exchange = 'NSE' and x.interval = '1d'
      and x.ts <= d.ts and x.ts > d.ts - interval '7 days'
    order by x.ts desc limit 1
  ) v on true
  on conflict (day) do update
    set nifty = excluded.nifty, nifty_sma50 = excluded.nifty_sma50, nifty_sma200 = excluded.nifty_sma200,
        vix = excluded.vix, state = excluded.state, updated_at = now()
    where (market_weather.nifty, market_weather.nifty_sma50, market_weather.nifty_sma200, market_weather.vix,
           market_weather.state)
          is distinct from (excluded.nifty, excluded.nifty_sma50, excluded.nifty_sma200, excluded.vix, excluded.state);
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function private.refresh_market_weather() from public, anon, authenticated;

-- ------------------------------------------------------------------ 2. strong trend
create or replace function private.refresh_strong_trend(p_symbols text[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  sym     record;
  v_ts    timestamptz[];
  v_o     numeric[];
  v_l     numeric[];
  v_c     numeric[];
  v_v     numeric[];
  v_hi    numeric[];
  v_n252  integer[];
  v_vol50 numeric[];
  v_n50   integer[];
  v_sma50 numeric[];
  v_atr   numeric[];
  v_natr  integer[];
  v_wx    text[];
  n       integer;
  i       integer;
  j       integer;
  k       integer;
  m       integer;
  busy    integer;
  v_stop  numeric;
  v_px    numeric;
  v_how   text;
  g_type  text[];
  g_pay   jsonb[];
  g_at    timestamptz[];
  v_cnt   integer;
  n_sig   integer := 0;
begin
  for sym in
    select s.symbol, s.exchange from public.market_symbols s
    where s.is_active and s.segment = 'equity' and s.mcap_rank <= 500
      and (p_symbols is null or s.symbol = any(p_symbols))
    order by s.symbol
  loop
    select array_agg(x.ts order by x.ts), array_agg(x.open order by x.ts), array_agg(x.low order by x.ts),
           array_agg(x.close order by x.ts), array_agg(x.volume::numeric order by x.ts),
           array_agg(x.hi252 order by x.ts), array_agg(x.n252 order by x.ts),
           array_agg(x.vol50 order by x.ts), array_agg(x.n50 order by x.ts), array_agg(x.sma50 order by x.ts),
           array_agg(x.atr14 order by x.ts), array_agg(x.natr order by x.ts), array_agg(x.state order by x.ts)
      into v_ts, v_o, v_l, v_c, v_v, v_hi, v_n252, v_vol50, v_n50, v_sma50, v_atr, v_natr, v_wx
      from (
        select t.*, w.state,
               max(t.close) over p252 as hi252, count(*) over p252 as n252,
               avg(t.volume) over p50 as vol50, count(*) over p50 as n50,
               avg(t.close) over w50 as sma50,
               avg(t.tr) over w14 as atr14, count(t.tr) over w14 as natr
        from (
          select c.ts, c.open, c.low, c.close, c.volume,
                 greatest(c.high - c.low, abs(c.high - lag(c.close) over o), abs(c.low - lag(c.close) over o)) as tr
          from public.market_candles c
          where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
          window o as (order by c.ts)
        ) t
        left join public.market_weather w on w.day = (t.ts at time zone 'Asia/Kolkata')::date
        window p252 as (order by t.ts rows between 252 preceding and 1 preceding),
               p50  as (order by t.ts rows between 50 preceding and 1 preceding),
               w50  as (order by t.ts rows 49 preceding),
               w14  as (order by t.ts rows 13 preceding)
      ) x;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 254;

    g_type := '{}'; g_pay := '{}'; g_at := '{}';
    busy := 0;
    for i in 2..n loop
      continue when i <= busy;
      continue when v_n252[i] < 252 or v_n50[i] < 50 or v_natr[i] < 14 or v_wx[i] is distinct from 'sunny';
      continue when not (v_c[i] > v_hi[i] and v_v[i] >= 2 * v_vol50[i] and v_c[i] > v_sma50[i]);
      v_stop := round(v_c[i] - 4 * v_atr[i], 2);
      continue when v_stop <= 0;

      g_type := g_type || 'buy'::text;
      g_pay := g_pay || jsonb_build_object(
        'action', 'buy', 'direction', 'buy', 'label', 'Strong trend',
        'close', v_c[i], 'stop', v_stop, 'atr14', round(v_atr[i], 2), 'high_52w', v_hi[i],
        'volume_ratio', round(v_v[i] / nullif(v_vol50[i], 0), 2), 'sma50', round(v_sma50[i], 2),
        'weather', 'sunny', 'review_sessions', 60);
      g_at := g_at || (v_ts[i] + interval '25 minutes');

      j := i + 1;                                   -- entry: the next session's open
      if j > n then busy := n; continue; end if;    -- signalled on the latest candle: no entry yet
      k := null;
      for m in j..least(j + 59, n) loop
        if v_l[m] <= v_stop then
          k := m; v_px := least(v_o[m], v_stop); v_how := 'STOP_HIT';
          exit;
        end if;
      end loop;
      if k is null then
        if j + 59 > n then busy := n; continue; end if;   -- still open: no exit yet, no new buy
        k := j + 59; v_px := v_c[k]; v_how := 'REVIEW_60';
      end if;
      busy := k;
      g_type := g_type || 'exit'::text;
      g_pay := g_pay || jsonb_build_object(
        'action', 'exit', 'direction', 'buy',
        'label', case v_how when 'STOP_HIT' then 'Strong trend: safety stop' else 'Strong trend: 60-session review' end,
        'close', v_px, 'exit_price', v_px, 'entry_fill', v_o[j], 'result', v_how,
        'pnl_pct', round((v_px / v_o[j] - 1) * 100, 2), 'bars_held', k - j + 1);
      g_at := g_at || (v_ts[k] + interval '25 minutes');
    end loop;

    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select sym.symbol, sym.exchange, 'strong_trend', x.t, x.p, x.at
    from unnest(g_type, g_pay, g_at) as x(t, p, at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $$;
revoke all on function private.refresh_strong_trend(text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ 3. grading
create table public.signal_outcomes (
  signal_id   bigint primary key references public.trading_signals (id) on delete cascade,
  symbol      text not null,
  exchange    public.exchange_code not null,
  strategy    text not null,
  side        text not null check (side in ('long', 'short')),
  signal_day  date not null,
  weather     text,
  entry_day   date not null,
  entry_price numeric not null check (entry_price > 0),
  stop        numeric,
  -- move from the entry to the close of session N (entry day = 1), positive = the signal was right
  r5          numeric,
  r20         numeric,
  r60         numeric,
  -- the Nifty 500 over the same sessions (raw index move, not sign-adjusted)
  idx5        numeric,
  idx20       numeric,
  idx60       numeric,
  stop_hit_20 boolean,
  graded_at   timestamptz not null default now()
);
create index signal_outcomes_strategy_idx on public.signal_outcomes (strategy, signal_day desc);
alter table public.signal_outcomes enable row level security;
create policy signal_outcomes_read on public.signal_outcomes for select to authenticated using (true);
revoke insert, update, delete on public.signal_outcomes from authenticated;
revoke all on public.signal_outcomes from anon;

-- Entry signals are buys (signal_type 'buy') and KK short entries (payload action 'sell'). A signal with a
-- payload 'fill' (KK) entered that day at the fill; every other one at the next session's open.
create or replace function private.grade_signals(p_symbols text[] default null,
                                                 p_since timestamptz default now() - interval '200 days')
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  with todo as (
    select t.id, t.symbol, t.exchange, t.strategy,
           case when t.payload->>'action' = 'sell' then 'short' else 'long' end as side,
           (t.generated_at at time zone 'Asia/Kolkata')::date as day,
           case when t.payload->>'fill' ~ '^[0-9.]+$' then (t.payload->>'fill')::numeric end as fill,
           case when t.payload->>'stop' ~ '^[0-9.]+$' then (t.payload->>'stop')::numeric end as stop
    from public.trading_signals t
    left join public.signal_outcomes o on o.signal_id = t.id
    where (p_since is null or t.generated_at >= p_since)
      and (p_symbols is null or t.symbol = any(p_symbols))
      and ((t.signal_type = 'buy' and coalesce(t.payload->>'action', 'buy') = 'buy') or t.payload->>'action' = 'sell')
      and (o.signal_id is null or o.r60 is null)
  ),
  win as (
    select td.id, w.session, w.day, w.open, w.high, w.low, w.close
    from todo td
    cross join lateral (
      select row_number() over (order by c.ts) as session, (c.ts at time zone 'Asia/Kolkata')::date as day,
             c.open, c.high, c.low, c.close
      from public.market_candles c
      where c.symbol = td.symbol and c.exchange = td.exchange and c.interval = '1d'
        and c.ts >= ((td.day + case when td.fill is null then 1 else 0 end)::timestamp at time zone 'Asia/Kolkata')
      order by c.ts
      limit 60
    ) w
  ),
  g as (
    select td.id, td.symbol, td.exchange, td.strategy, td.side, td.day, td.stop,
           min(w.day) filter (where w.session = 1)                     as entry_day,
           coalesce(td.fill, max(w.open) filter (where w.session = 1)) as entry,
           max(w.close) filter (where w.session = 5)  as c5,
           max(w.close) filter (where w.session = 20) as c20,
           max(w.close) filter (where w.session = 60) as c60,
           max(w.day) filter (where w.session = 5)    as d5,
           max(w.day) filter (where w.session = 20)   as d20,
           max(w.day) filter (where w.session = 60)   as d60,
           case when td.stop is null or count(*) filter (where w.session <= 20) < 20 then null
                when td.side = 'long' then bool_or(w.low <= td.stop) filter (where w.session <= 20)
                else bool_or(w.high >= td.stop) filter (where w.session <= 20) end as stop20
    from todo td
    join win w on w.id = td.id
    group by td.id, td.symbol, td.exchange, td.strategy, td.side, td.day, td.stop, td.fill
  ),
  idx as (
    select (c.ts at time zone 'Asia/Kolkata')::date as day, c.open, c.close
    from public.market_candles c
    where c.symbol = 'NIFTY500' and c.exchange = 'NSE' and c.interval = '1d'
  ),
  graded as (
    select g.*, wx.state as weather,
           case when g.side = 'long' then 1 else -1 end * (g.c5 / g.entry - 1)  as r5,
           case when g.side = 'long' then 1 else -1 end * (g.c20 / g.entry - 1) as r20,
           case when g.side = 'long' then 1 else -1 end * (g.c60 / g.entry - 1) as r60,
           i5.close / nullif(i0.open, 0) - 1  as idx5,
           i20.close / nullif(i0.open, 0) - 1 as idx20,
           i60.close / nullif(i0.open, 0) - 1 as idx60
    from g
    left join public.market_weather wx on wx.day = g.day
    left join idx i0 on i0.day = g.entry_day
    left join idx i5 on i5.day = g.d5
    left join idx i20 on i20.day = g.d20
    left join idx i60 on i60.day = g.d60
    where g.entry > 0 and g.entry_day is not null
  )
  insert into public.signal_outcomes (signal_id, symbol, exchange, strategy, side, signal_day, weather, entry_day,
                                      entry_price, stop, r5, r20, r60, idx5, idx20, idx60, stop_hit_20, graded_at)
  select id, symbol, exchange, strategy, side, day, weather, entry_day, entry, stop,
         round(r5, 6), round(r20, 6), round(r60, 6), round(idx5, 6), round(idx20, 6), round(idx60, 6), stop20, now()
  from graded
  on conflict (signal_id) do update
    set weather = excluded.weather, r5 = excluded.r5, r20 = excluded.r20, r60 = excluded.r60,
        idx5 = excluded.idx5, idx20 = excluded.idx20, idx60 = excluded.idx60,
        stop_hit_20 = excluded.stop_hit_20, graded_at = now()
    where (signal_outcomes.r5, signal_outcomes.r20, signal_outcomes.r60, signal_outcomes.idx60, signal_outcomes.weather)
          is distinct from (excluded.r5, excluded.r20, excluded.r60, excluded.idx60, excluded.weather);
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function private.grade_signals(text[], timestamptz) from public, anon, authenticated;

-- Each strategy's record, all time and the last 12 months. 'beat' = did better than the Nifty 500 over the
-- same sessions (a short beats it by falling more than the index). Moves are before costs.
create view public.strategy_scorecard
with (security_invoker = true) as
select o.strategy, o.side, p.period,
       count(*)                                                    as signals,
       count(o.r20)                                                as graded_20,
       round(100.0 * count(*) filter (where o.r20 > 0) / nullif(count(o.r20), 0), 1)  as up_20_pct,
       round(100 * avg(o.r20), 2)                                  as avg_move_20_pct,
       round(100.0 * count(*) filter (where o.r20 - sgn * o.idx20 > 0) / nullif(count(o.r20 - sgn * o.idx20), 0), 1)
                                                                   as beat_index_20_pct,
       round(100 * avg(o.r20 - sgn * o.idx20), 2)                  as vs_index_20_pts,
       count(o.r60)                                                as graded_60,
       round(100.0 * count(*) filter (where o.r60 > 0) / nullif(count(o.r60), 0), 1)  as up_60_pct,
       round(100 * avg(o.r60 - sgn * o.idx60), 2)                  as vs_index_60_pts,
       round(100.0 * count(*) filter (where o.stop_hit_20) / nullif(count(o.stop_hit_20), 0), 1) as stop_hit_20_pct,
       min(o.signal_day)                                           as first_day,
       max(o.signal_day)                                           as last_day
from (select so.*, case when so.side = 'long' then 1 else -1 end as sgn from public.signal_outcomes so) o
cross join (values ('all'), ('12m')) as p(period)
where p.period = 'all' or o.signal_day >= current_date - 365
group by o.strategy, o.side, p.period;
revoke all on public.strategy_scorecard from anon, public;
grant select on public.strategy_scorecard to authenticated;

-- ------------------------------------------------------------------ pipeline wrapper + backstop
create or replace function public.svc_refresh_market_analytics(p_days integer default 10, p_symbols text[] default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  v_out := private.refresh_market_analytics(p_days, p_symbols);
  v_out := v_out || jsonb_build_object('setups', private.refresh_setups(p_symbols));
  v_out := v_out || jsonb_build_object('weather', private.refresh_market_weather());
  v_out := v_out || jsonb_build_object('strong_trend', private.refresh_strong_trend(p_symbols));
  v_out := v_out || jsonb_build_object('graded', private.grade_signals(p_symbols));
  return v_out;
end $$;
revoke execute on function public.svc_refresh_market_analytics(integer, text[]) from public, anon, authenticated;
grant  execute on function public.svc_refresh_market_analytics(integer, text[]) to service_role;

select cron.schedule('market-analytics', '25 12 * * 1-5',
  $$ select private.refresh_market_analytics(10); select private.refresh_setups();
     select private.refresh_market_weather(); select private.refresh_strong_trend(); select private.grade_signals(); $$);

-- Build what the stored candles already allow: the weather, every Strong trend signal, and a grade for
-- every stored entry signal whose candles are still kept.
select private.refresh_market_weather();
select private.refresh_strong_trend();
select private.grade_signals(null, null);
