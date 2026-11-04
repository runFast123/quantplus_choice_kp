-- The five rules continue their stored record instead of starting it again each night (ADR-043).
-- Each rule keeps one trade per stock and used to rebuild that chain of trades from the oldest stored candle. The
-- nightly retention trims the oldest candles (history_days), so the chain's first trade could drop out and the chain
-- restart on a different day, writing a second trade over a stored one (a PGlite run on the live-candle copy: 30 days
-- trimmed gave 12 overlapping 200-day trend rows and 66 Strong trend rows). Now each rule:
--   1. starts after the stock's last stored signal of that rule (an open buy is followed again to its exit), and
--   2. writes only rows later than that last stored signal.
-- What a rule buys and sells is unchanged; rebuild_rule_signals deletes first, so a rebuild still runs on everything.

-- busy (the last session index the stored record covers) for one stock and rule: the last stored signal's session,
-- or the session before an open buy's signal day (p_back = 1 when the buy is dated on its signal day, 2 when it is
-- dated on the entry day after it, as the dip rules do).
create or replace function private.rule_resume(p_symbol text, p_exchange public.exchange_code, p_strategy text,
                                               p_ts timestamptz[], p_back integer) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  v_at   timestamptz;
  v_type text;
  v_i    integer;
begin
  select t.generated_at, t.signal_type into v_at, v_type
    from public.trading_signals t
   where t.symbol = p_symbol and t.exchange = p_exchange and t.strategy = p_strategy
   order by t.generated_at desc
   limit 1;
  if v_at is null then
    return 0;
  end if;
  select count(*) into v_i from unnest(p_ts) as u(ts) where u.ts <= v_at;
  return greatest(case when v_type = 'buy' then v_i - p_back else v_i end, 0);
end $$;
revoke all on function private.rule_resume(text, public.exchange_code, text, timestamptz[], integer) from public, anon, authenticated;

-- ------------------------------------------------------------------ refresh_strong_trend (st), continuing
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
    busy := private.rule_resume(sym.symbol, sym.exchange, 'strong_trend', v_ts, 1);
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
    where not exists (select 1 from public.trading_signals o
                      where o.symbol = sym.symbol and o.exchange = sym.exchange and o.strategy = 'strong_trend'
                        and o.generated_at >= x.at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $$;
revoke all on function private.refresh_strong_trend(text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ refresh_sma_trend (sm), continuing
create or replace function private.refresh_sma_trend(p_symbols text[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  sym     record;
  v_ts    timestamptz[];
  v_o     numeric[];
  v_l     numeric[];
  v_c     numeric[];
  v_s20   numeric[];
  v_s50   numeric[];
  v_atr   numeric[];
  v_natr  integer[];
  v_rs    numeric[];
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
  perform private.refresh_leaders();
  for sym in
    select s.symbol, s.exchange from public.market_symbols s
    where s.is_active and s.segment = 'equity' and s.mcap_rank <= 500
      and (p_symbols is null or s.symbol = any(p_symbols))
    order by s.symbol
  loop
    select array_agg(x.ts order by x.ts), array_agg(x.open order by x.ts), array_agg(x.low order by x.ts),
           array_agg(x.close order by x.ts), array_agg(x.s20 order by x.ts), array_agg(x.s50 order by x.ts),
           array_agg(x.atr14 order by x.ts), array_agg(x.natr order by x.ts), array_agg(x.rs_pct order by x.ts)
      into v_ts, v_o, v_l, v_c, v_s20, v_s50, v_atr, v_natr, v_rs
      from (
        select t.*, ld.rs_pct,
               case when count(*) over w20 = 20 then avg(t.close) over w20 end as s20,
               case when count(*) over w50 = 50 then avg(t.close) over w50 end as s50,
               avg(t.tr) over w14 as atr14, count(t.tr) over w14 as natr
        from (
          select c.ts, c.open, c.low, c.close,
                 greatest(c.high - c.low, abs(c.high - lag(c.close) over o), abs(c.low - lag(c.close) over o)) as tr
          from public.market_candles c
          where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
          window o as (order by c.ts)
        ) t
        left join public.market_leaders ld
          on ld.symbol = sym.symbol and ld.exchange = sym.exchange and ld.day = (t.ts at time zone 'Asia/Kolkata')::date
        window w20 as (order by t.ts rows 19 preceding), w50 as (order by t.ts rows 49 preceding),
               w14 as (order by t.ts rows 13 preceding)
      ) x;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 52;

    g_type := '{}'; g_pay := '{}'; g_at := '{}';
    busy := private.rule_resume(sym.symbol, sym.exchange, 'sma_trend', v_ts, 1);
    for i in 51..n loop
      continue when i <= busy or v_s50[i] is null or v_s50[i - 1] is null or v_natr[i] < 14;
      continue when not (v_s20[i] > v_s50[i] and v_s20[i - 1] <= v_s50[i - 1]);
      continue when v_rs[i] is null or v_rs[i] < 0.7;
      v_stop := round(v_c[i] - 4 * v_atr[i], 2);
      continue when v_stop <= 0;

      g_type := g_type || 'buy'::text;
      g_pay := g_pay || jsonb_build_object(
        'action', 'buy', 'direction', 'buy', 'label', 'SMA 20/50 trend',
        'close', v_c[i], 'stop', v_stop, 'atr14', round(v_atr[i], 2), 'sma20', round(v_s20[i], 2), 'sma50', round(v_s50[i], 2),
        'rs_pct', round(v_rs[i], 3), 'review_sessions', 60);
      g_at := g_at || (v_ts[i] + interval '15 minutes');

      j := i + 1;                                   -- entry: the next session's open
      if j > n then busy := n; continue; end if;
      k := null;
      for m in j..least(j + 59, n) loop
        if v_l[m] <= v_stop then
          k := m; v_px := least(v_o[m], v_stop); v_how := 'STOP_HIT';
          exit;
        end if;
      end loop;
      if k is null then
        if j + 59 > n then busy := n; continue; end if;   -- still open
        k := j + 59; v_px := v_c[k]; v_how := 'REVIEW_60';
      end if;
      busy := k;
      g_type := g_type || 'exit'::text;
      g_pay := g_pay || jsonb_build_object(
        'action', 'exit', 'direction', 'buy',
        'label', case v_how when 'STOP_HIT' then 'SMA 20/50 trend: safety stop' else 'SMA 20/50 trend: 60-session review' end,
        'close', v_px, 'exit_price', v_px, 'entry_fill', v_o[j], 'result', v_how,
        'pnl_pct', round((v_px / v_o[j] - 1) * 100, 2), 'bars_held', k - j + 1);
      g_at := g_at || (v_ts[k] + interval '15 minutes');
    end loop;

    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select sym.symbol, sym.exchange, 'sma_trend', x.t, x.p, x.at
    from unnest(g_type, g_pay, g_at) as x(t, p, at)
    where not exists (select 1 from public.trading_signals o
                      where o.symbol = sym.symbol and o.exchange = sym.exchange and o.strategy = 'sma_trend'
                        and o.generated_at >= x.at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $$;
revoke all on function private.refresh_sma_trend(text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ refresh_ma200_trend (ma), continuing
create or replace function private.refresh_ma200_trend(p_symbols text[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  sym     record;
  v_ts    timestamptz[];
  v_o     numeric[];
  v_l     numeric[];
  v_c     numeric[];
  v_sma   numeric[];
  v_slope float8[];
  v_r     float8[];
  v_atr   numeric[];
  v_natr  integer[];
  n       integer;
  i       integer;
  j       integer;
  k       integer;
  m       integer;
  busy    integer;
  v_ok    boolean;
  v_prev  boolean;
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
    select array_agg(z.ts order by z.ts), array_agg(z.open order by z.ts), array_agg(z.low order by z.ts),
           array_agg(z.close order by z.ts), array_agg(z.sma200 order by z.ts), array_agg(z.slope_pct order by z.ts),
           array_agg(z.r_px order by z.ts), array_agg(z.atr14 order by z.ts), array_agg(z.natr order by z.ts)
      into v_ts, v_o, v_l, v_c, v_sma, v_slope, v_r, v_atr, v_natr
      from (
        select y.ts, y.open, y.low, y.close, y.sma200, y.atr14, y.natr,
               -- the fitted line's change over 20 sessions, in % of today's 200-day average
               case when y.n_slope = 100 then 2000 * y.slope / y.sma200::float8 end as slope_pct,
               case when y.n_r = 100 then y.r end as r_px
        from (
          select x.*,
                 regr_slope(x.sma200::float8, x.k::float8) over w100 as slope,
                 regr_count(x.sma200::float8, x.k::float8) over w100 as n_slope,
                 corr(x.close::float8, x.k::float8) over w100 as r,
                 count(*) over w100 as n_r
          from (
            select t.ts, t.open, t.low, t.close, row_number() over (order by t.ts) as k,
                   case when count(*) over w200 = 200 then avg(t.close) over w200 end as sma200,
                   avg(t.tr) over w14 as atr14, count(t.tr) over w14 as natr
            from (
              select c.ts, c.open, c.low, c.close,
                     greatest(c.high - c.low, abs(c.high - lag(c.close) over o), abs(c.low - lag(c.close) over o)) as tr
              from public.market_candles c
              where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
              window o as (order by c.ts)
            ) t
            window w200 as (order by t.ts rows 199 preceding), w14 as (order by t.ts rows 13 preceding)
          ) x
          window w100 as (order by x.ts rows 99 preceding)
        ) y
      ) z;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 300;

    g_type := '{}'; g_pay := '{}'; g_at := '{}';
    busy := private.rule_resume(sym.symbol, sym.exchange, 'ma200_trend', v_ts, 1);
    v_prev := null;                                 -- null = the day before could not be measured
    for i in 1..n loop
      if v_sma[i] is null or v_slope[i] is null or v_r[i] is null then
        v_ok := null;
      else
        v_ok := v_c[i] > v_sma[i] and v_slope[i] >= -0.25 and v_r[i] >= 0.5;
      end if;
      if v_ok and v_prev is not null and not v_prev and i > busy and v_natr[i] >= 14 then
        v_stop := round(v_c[i] - 4 * v_atr[i], 2);
        if v_stop > 0 then
          g_type := g_type || 'buy'::text;
          g_pay := g_pay || jsonb_build_object(
            'action', 'buy', 'direction', 'buy', 'label', '200-day trend',
            'close', v_c[i], 'stop', v_stop, 'atr14', round(v_atr[i], 2), 'sma200', round(v_sma[i], 2),
            'slope_pct', round(v_slope[i]::numeric, 2), 'r_px', round(v_r[i]::numeric, 2), 'review_sessions', 60);
          g_at := g_at || (v_ts[i] + interval '15 minutes');

          j := i + 1;                               -- entry: the next session's open
          if j > n then
            busy := n;
          else
            k := null;
            for m in j..least(j + 59, n) loop
              if v_l[m] <= v_stop then
                k := m; v_px := least(v_o[m], v_stop); v_how := 'STOP_HIT';
                exit;
              end if;
            end loop;
            if k is null and j + 59 > n then
              busy := n;                            -- still open
            else
              if k is null then k := j + 59; v_px := v_c[k]; v_how := 'REVIEW_60'; end if;
              busy := k;
              g_type := g_type || 'exit'::text;
              g_pay := g_pay || jsonb_build_object(
                'action', 'exit', 'direction', 'buy',
                'label', case v_how when 'STOP_HIT' then '200-day trend: safety stop' else '200-day trend: 60-session review' end,
                'close', v_px, 'exit_price', v_px, 'entry_fill', v_o[j], 'result', v_how,
                'pnl_pct', round((v_px / v_o[j] - 1) * 100, 2), 'bars_held', k - j + 1);
              g_at := g_at || (v_ts[k] + interval '15 minutes');
            end if;
          end if;
        end if;
      end if;
      v_prev := v_ok;
    end loop;

    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select sym.symbol, sym.exchange, 'ma200_trend', x.t, x.p, x.at
    from unnest(g_type, g_pay, g_at) as x(t, p, at)
    where not exists (select 1 from public.trading_signals o
                      where o.symbol = sym.symbol and o.exchange = sym.exchange and o.strategy = 'ma200_trend'
                        and o.generated_at >= x.at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $$;
revoke all on function private.refresh_ma200_trend(text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ refresh_dip_rules (di), continuing
create or replace function private.refresh_dip_rules(p_symbols text[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  sym      record;
  v_latest timestamptz;
  v_ts     timestamptz[];
  v_o      numeric[];
  v_h      numeric[];
  v_l      numeric[];
  v_c      numeric[];
  v_s5     numeric[];
  v_s200   numeric[];
  v_lo20   numeric[];
  v_atr    float8[];
  v_rsi2   float8[];
  n        integer;
  t        integer;
  i        integer;
  j        integer;
  k        integer;
  m        integer;
  busy     integer;
  a        float8;
  g        float8;
  ls       float8;
  d        float8;
  tr       float8;
  v_rule   text;
  v_hit    boolean;
  v_lim    numeric;
  v_e      numeric;
  v_stop   numeric;
  v_px     numeric;
  v_how    text;
  v_label  text;
  v_extra  jsonb;
  g_strat  text[];
  g_type   text[];
  g_pay    jsonb[];
  g_at     timestamptz[];
  v_cnt    integer;
  n_sig    integer := 0;
begin
  select max(c.ts) into v_latest from public.market_candles c
   where c.symbol = 'NIFTY' and c.exchange = 'NSE' and c.interval = '1d';
  -- A dip-buy level is good for the next session only.
  delete from public.signal_watch w where w.signal_day < (v_latest at time zone 'Asia/Kolkata')::date;

  for sym in
    select s.symbol, s.exchange from public.market_symbols s
    where s.is_active and s.segment = 'equity' and s.mcap_rank <= 500
      and (p_symbols is null or s.symbol = any(p_symbols))
    order by s.symbol
  loop
    delete from public.signal_watch w where w.symbol = sym.symbol and w.exchange = sym.exchange;
    select array_agg(x.ts order by x.ts), array_agg(x.open order by x.ts), array_agg(x.high order by x.ts),
           array_agg(x.low order by x.ts), array_agg(x.close order by x.ts), array_agg(x.s5 order by x.ts),
           array_agg(x.s200 order by x.ts), array_agg(x.lo20 order by x.ts)
      into v_ts, v_o, v_h, v_l, v_c, v_s5, v_s200, v_lo20
      from (
        select c.ts, c.open, c.high, c.low, c.close,
               case when count(*) over w5 = 5 then avg(c.close) over w5 end as s5,
               case when count(*) over w200 = 200 then avg(c.close) over w200 end as s200,
               case when count(*) over p20 = 20 then min(c.low) over p20 end as lo20
        from public.market_candles c
        where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
        window w5 as (order by c.ts rows 4 preceding), w200 as (order by c.ts rows 199 preceding),
               p20 as (order by c.ts rows between 20 preceding and 1 preceding)
      ) x;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 202;

    -- ATR14 and RSI(2) as exponential averages (the tested definitions)
    v_atr := array_fill(null::float8, array[n]);
    v_rsi2 := array_fill(null::float8, array[n]);
    for t in 1..n loop
      tr := case when t = 1 then (v_h[t] - v_l[t])::float8
                 else greatest(v_h[t] - v_l[t], abs(v_h[t] - v_c[t - 1]), abs(v_l[t] - v_c[t - 1]))::float8 end;
      a := case when t = 1 then tr else a + (tr - a) / 14 end;
      if t >= 14 then v_atr[t] := a; end if;
      if t >= 2 then
        d := (v_c[t] - v_c[t - 1])::float8;
        if t = 2 then g := greatest(d, 0); ls := greatest(-d, 0);
        else g := 0.5 * g + 0.5 * greatest(d, 0); ls := 0.5 * ls + 0.5 * greatest(-d, 0); end if;
        if t >= 3 then v_rsi2[t] := case when ls = 0 then 100 else 100 - 100 / (1 + g / ls) end; end if;
      end if;
    end loop;

    g_strat := '{}'; g_type := '{}'; g_pay := '{}'; g_at := '{}';
    foreach v_rule in array array['rsi_dip', 'kk_dip'] loop
      v_label := case v_rule when 'rsi_dip' then 'RSI dip' else 'KK dip' end;
      busy := private.rule_resume(sym.symbol, sym.exchange, v_rule, v_ts, 2);
      for i in 1..n loop
        continue when i <= busy or v_atr[i] is null or v_s200[i] is null or v_c[i] <= v_s200[i];
        v_hit := case v_rule when 'rsi_dip' then v_rsi2[i] < 10
                             else v_lo20[i] is not null and v_l[i] <= 0.99 * v_lo20[i] end;
        continue when not coalesce(v_hit, false);
        v_lim := round(v_c[i] - v_atr[i]::numeric, 2);
        continue when v_lim <= 0;
        v_extra := case v_rule when 'rsi_dip' then jsonb_build_object('rsi2', round(v_rsi2[i]::numeric, 1))
                               else jsonb_build_object('low_20d', v_lo20[i]) end;
        j := i + 1;
        if j > n then
          -- signalled on the latest close: tomorrow's dip-buy level
          if v_ts[i] = v_latest then
            insert into public.signal_watch (symbol, exchange, strategy, signal_day, limit_price, stop, payload)
            values (sym.symbol, sym.exchange, v_rule, (v_ts[i] at time zone 'Asia/Kolkata')::date, v_lim,
                    round(v_lim - 5 * v_atr[i]::numeric, 2),
                    v_extra || jsonb_build_object('signal_close', v_c[i], 'atr14', round(v_atr[i]::numeric, 2)));
          end if;
          continue;
        end if;
        continue when v_l[j] > v_lim * 0.998;                  -- the dip did not come: no trade
        v_e := least(v_o[j], v_lim);
        v_stop := round(v_e - 5 * v_atr[i]::numeric, 2);
        k := null;
        for m in j..least(j + 9, n) loop
          if v_l[m] <= v_stop then
            k := m; v_px := case when m > j then least(v_o[m], v_stop) else v_stop end; v_how := 'STOP_HIT';
            exit;
          end if;
          if v_s5[m] is not null and v_c[m] > v_s5[m] then
            k := m; v_px := v_c[m]; v_how := 'BOUNCE';
            exit;
          end if;
        end loop;

        g_strat := g_strat || v_rule;
        g_type := g_type || 'buy'::text;
        g_pay := g_pay || (v_extra || jsonb_build_object(
          'action', 'buy', 'direction', 'buy', 'label', v_label, 'close', v_e, 'fill', v_e, 'limit', v_lim,
          'signal_day', to_char(v_ts[i] at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), 'signal_close', v_c[i],
          'stop', v_stop, 'atr14', round(v_atr[i]::numeric, 2), 'max_sessions', 10));
        g_at := g_at || (v_ts[j] + interval '30 minutes');

        if k is null then
          if j + 9 > n then busy := n; continue; end if;     -- still open
          k := j + 9; v_px := v_c[k]; v_how := 'TIME_10';
        end if;
        busy := k;
        g_strat := g_strat || v_rule;
        g_type := g_type || 'exit'::text;
        g_pay := g_pay || jsonb_build_object(
          'action', 'exit', 'direction', 'buy',
          'label', v_label || case v_how when 'BOUNCE' then ': sold on the bounce'
                                         when 'STOP_HIT' then ': safety stop' else ': 10 sessions passed' end,
          'close', v_px, 'exit_price', v_px, 'entry_fill', v_e, 'result', v_how,
          'pnl_pct', round((v_px / v_e - 1) * 100, 2), 'bars_held', k - j + 1);
        g_at := g_at || (v_ts[k] + interval '35 minutes');
      end loop;
    end loop;

    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select sym.symbol, sym.exchange, x.s, x.t, x.p, x.at
    from unnest(g_strat, g_type, g_pay, g_at) as x(s, t, p, at)
    where not exists (select 1 from public.trading_signals o
                      where o.symbol = sym.symbol and o.exchange = sym.exchange and o.strategy = x.s
                        and o.generated_at >= x.at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $$;
revoke all on function private.refresh_dip_rules(text[]) from public, anon, authenticated;
