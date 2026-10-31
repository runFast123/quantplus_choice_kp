-- SMA 20/50, fixed (ADR-037): the 20/50 cross in a market leader, with Strong trend's plan, replaces the old cross.
--
-- Research (research/strategies/improve_sma.py, record_sma.py; 2019-2026, each year's 300 most traded stocks, 0.5 %
-- round-trip cost): the old rule bought every 20/50 cross and sold on the cross back down: 43 % of trades made money
-- (37 % in 2024-26). Of 24 pre-written variants, the one with the fewest losing trades in 2019-23 was confirmed in
-- 2024-26: 52 % made money overall (46 % in 2024-26), +5.6 % a trade (+2.3 %).
--   sma_trend  the 20-day average closes above the 50-day average (exact decimal averages, as before), and the stock is
--              a leader that day: its 126-session return in the top 30 % of the 500 largest companies
--              (cume_dist >= 0.7, public.market_leaders)
--   plan       entry at the next open; safety stop = close - 4 x ATR14 (simple 14-day average true range); out at the
--              stop (or the open, if it gaps under), otherwise the close of the 60th session. One trade per stock.
--              The same plan as Strong trend; the 500 largest companies.
-- The old SMA 20/50 cross stops producing signals (its block leaves refresh_market_analytics); its stored signals and
-- grades stay as history.

-- ------------------------------------------------------------------ 1. analytics without SMA 20/50 cross signals
create or replace function private.refresh_market_analytics(p_days integer default 10, p_symbols text[] default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_since   timestamptz := now() - make_interval(days => greatest(p_days, 1));
  sym       record;
  v_ts      timestamptz[];
  v_c       numeric[];
  v_h       numeric[];
  v_l       numeric[];
  v_v       bigint[];
  n         integer;
  i         integer;
  v_rsi     numeric[];
  s20       numeric[];
  s50       numeric[];
  sum20     numeric;
  sum50     numeric;
  g         float8;
  l         float8;
  d         float8;
  t         text;
  v_daily_from timestamptz;
  e_ts      timestamptz[];
  e_rsi     numeric[];
  e_type    text[];
  g_strat   text[];
  g_type    text[];
  g_payload jsonb[];
  g_at      timestamptz[];
  v_month   text;
  v_prev_m  text;
  v_units   numeric;
  v_run     numeric;
  v_k       integer;
  v_entries jsonb[];
  v_hi      numeric;
  v_lo      numeric;
  v_sig     record;
  v_cnt     integer;
  n_rsi     integer := 0;
  n_sig     integer := 0;
  n_led     integer := 0;
  n_q       integer := 0;
begin
  for sym in
    select s.symbol, s.exchange from public.market_symbols s
    where s.is_active and (p_symbols is null or s.symbol = any(p_symbols))
    order by s.symbol
  loop
    select array_agg(c.ts order by c.ts), array_agg(c.close order by c.ts), array_agg(c.high order by c.ts),
           array_agg(c.low order by c.ts), array_agg(c.volume order by c.ts)
      into v_ts, v_c, v_h, v_l, v_v
      from public.market_candles c
     where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d';
    n := coalesce(cardinality(v_ts), 0);
    if n = 0 then
      delete from public.market_quotes q where q.symbol = sym.symbol and q.exchange = sym.exchange;
      continue;
    end if;

    v_rsi := array_fill(null::numeric, array[n]);
    s20 := array_fill(null::numeric, array[n]);
    s50 := array_fill(null::numeric, array[n]);
    sum20 := 0; sum50 := 0; g := 0; l := 0;
    for i in 1..n loop
      sum20 := sum20 + v_c[i];
      if i > 20 then sum20 := sum20 - v_c[i - 20]; end if;
      sum50 := sum50 + v_c[i];
      if i > 50 then sum50 := sum50 - v_c[i - 50]; end if;
      s20[i] := sum20 / least(i, 20);
      s50[i] := sum50 / least(i, 50);
      if i > 1 then
        d := v_c[i]::float8 - v_c[i - 1]::float8;
        if i <= 15 then
          g := g + greatest(d, 0) / 14;
          l := l + greatest(-d, 0) / 14;
        else
          g := (g * 13 + greatest(d, 0)) / 14;
          l := (l * 13 + greatest(-d, 0)) / 14;
        end if;
        if i >= 15 then
          v_rsi[i] := case when l = 0 then 100 else round((100 - 100 / (1 + g / l))::numeric, 2) end;
        end if;
      end if;
    end loop;

    -- RSI events + signals
    v_daily_from := greatest(v_since, v_ts[n] - interval '35 days');
    e_ts := '{}'; e_rsi := '{}'; e_type := '{}';
    g_strat := '{}'; g_type := '{}'; g_payload := '{}'; g_at := '{}';
    for i in 2..n loop
      continue when v_ts[i] < v_since;
      if v_rsi[i] is not null then
        t := case when v_rsi[i] < 30 and coalesce(v_rsi[i - 1], 50) >= 30 then 'oversold_cross'
                  when v_rsi[i] > 70 and coalesce(v_rsi[i - 1], 50) <= 70 then 'overbought_cross'
                  else 'daily' end;
        if t <> 'daily' or v_ts[i] >= v_daily_from then
          e_ts := e_ts || v_ts[i]; e_rsi := e_rsi || v_rsi[i]; e_type := e_type || t;
        end if;
      end if;
      -- (SMA 20/50 cross signals retired by migration 38: the SMA 20/50 trend rule replaces them.)
      -- (RSI reversal signals retired by migration 35: the RSI dip rule replaces them.)
    end loop;

    insert into public.rsi_events (symbol, exchange, ts, rsi, event_type)
    select sym.symbol, sym.exchange, x.ts, x.rsi, x.t from unnest(e_ts, e_rsi, e_type) as x(ts, rsi, t)
    on conflict (symbol, exchange, ts) do update set rsi = excluded.rsi, event_type = excluded.event_type;
    get diagnostics v_cnt = row_count; n_rsi := n_rsi + v_cnt;

    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select sym.symbol, sym.exchange, x.s, x.t, x.p, x.at from unnest(g_strat, g_type, g_payload, g_at) as x(s, t, p, at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count; n_sig := n_sig + v_cnt;

    -- Monthly ₹10,000 SIP from the first candle, valued at the latest close.
    v_entries := '{}'; v_run := 0; v_k := 0; v_prev_m := null;
    for i in 1..n loop
      v_month := to_char(v_ts[i] at time zone 'Asia/Kolkata', 'YYYY-MM');
      if v_month is distinct from v_prev_m then
        v_prev_m := v_month;
        if v_c[i] > 0 then
          v_k := v_k + 1;
          v_units := round(10000 / v_c[i], 4);
          v_run := v_run + v_units;
          v_entries := v_entries || jsonb_build_object(
            'date', to_char(v_ts[i] at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), 'type', 'buy', 'price', v_c[i],
            'units', v_units, 'running_units', v_run, 'invested', v_k * 10000, 'value', round(v_run * v_c[i], 2));
        end if;
      end if;
    end loop;
    if v_k > 0 then
      insert into public.backtest_ledgers (symbol, exchange, ledger, roi_pct, computed_at)
      values (sym.symbol, sym.exchange,
              jsonb_build_object('strategy', 'monthly_sip', 'installment', 10000, 'entries', to_jsonb(v_entries),
                                 'invested', v_k * 10000, 'final_value', round(v_run * v_c[n], 2)),
              round((v_run * v_c[n] - v_k * 10000) / (v_k * 10000) * 100, 4), now())
      on conflict (symbol, exchange) do update
        set ledger = excluded.ledger, roi_pct = excluded.roi_pct, computed_at = excluded.computed_at;
      n_led := n_led + 1;
    end if;

    -- Latest quote
    v_hi := null; v_lo := null;
    for i in 1..n loop
      if v_ts[i] > v_ts[n] - interval '365 days' then
        v_hi := greatest(v_hi, v_h[i]);
        v_lo := least(v_lo, v_l[i]);
      end if;
    end loop;
    select ts.signal_type, ts.strategy, ts.generated_at into v_sig
      from public.trading_signals ts
     where ts.symbol = sym.symbol and ts.exchange = sym.exchange
     order by ts.generated_at desc limit 1;
    insert into public.market_quotes as q
      (symbol, exchange, as_of, last_price, prev_close, change, change_pct, volume, high_52w, low_52w, rsi,
       last_signal, last_signal_strategy, last_signal_at, updated_at)
    values (sym.symbol, sym.exchange, v_ts[n], v_c[n],
            case when n > 1 then v_c[n - 1] end,
            case when n > 1 then v_c[n] - v_c[n - 1] end,
            case when n > 1 and v_c[n - 1] > 0 then round((v_c[n] - v_c[n - 1]) / v_c[n - 1] * 100, 2) end,
            v_v[n], v_hi, v_lo, v_rsi[n], v_sig.signal_type, v_sig.strategy, v_sig.generated_at, now())
    on conflict (symbol, exchange) do update
      set as_of = excluded.as_of, last_price = excluded.last_price, prev_close = excluded.prev_close,
          change = excluded.change, change_pct = excluded.change_pct, volume = excluded.volume,
          high_52w = excluded.high_52w, low_52w = excluded.low_52w, rsi = excluded.rsi,
          last_signal = excluded.last_signal, last_signal_strategy = excluded.last_signal_strategy,
          last_signal_at = excluded.last_signal_at, updated_at = now();
    n_q := n_q + 1;
  end loop;

  return jsonb_build_object('rsi_events', n_rsi, 'signals', n_sig, 'ledgers', n_led, 'quotes', n_q);
end $$;


revoke all on function private.refresh_market_analytics(integer, text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ 2. market leaders: each day's 6-month return rank
create table public.market_leaders (
  day      date not null,
  symbol   text not null,
  exchange public.exchange_code not null,
  ret126   numeric not null,
  rs_pct   numeric not null check (rs_pct > 0 and rs_pct <= 1),
  primary key (day, symbol, exchange)
);
alter table public.market_leaders enable row level security;
create policy market_leaders_read on public.market_leaders for select to authenticated using (true);
revoke insert, update, delete on public.market_leaders from authenticated;
revoke all on public.market_leaders from anon;

-- rs_pct = cume_dist of the 126-session return among the active 500 largest companies that day. A normal run rewrites
-- the last 14 days, and only once per session: it returns at once when the latest session is already complete.
create or replace function private.refresh_leaders(p_full boolean default false) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_latest date;
  v_from   date;
  v_rows   integer;
begin
  select (max(c.ts) at time zone 'Asia/Kolkata')::date into v_latest
    from public.market_candles c where c.symbol = 'NIFTY' and c.exchange = 'NSE' and c.interval = '1d';
  if v_latest is null then return 0; end if;
  -- This session is already ranked when it has about as many rows as the session before (the pipeline stores every
  -- candle before it runs the analytics, so the first batch of a run ranks the day and the rest return here).
  if not p_full and (select count(*) from public.market_leaders l where l.day = v_latest) >= greatest(1, (
       select count(*) from public.market_leaders l
        where l.day = (select max(p.day) from public.market_leaders p where p.day < v_latest)) - 5) then
    return 0;
  end if;
  v_from := case when p_full then date '1900-01-01' else v_latest - 14 end;

  with r as (
    select c.symbol, c.exchange, (c.ts at time zone 'Asia/Kolkata')::date as day,
           c.close / nullif(lag(c.close, 126) over w, 0) - 1 as ret126
    from public.market_candles c
    join public.market_symbols s on s.symbol = c.symbol and s.exchange = c.exchange
    where s.is_active and s.segment = 'equity' and s.mcap_rank <= 500 and c.interval = '1d'
      and (p_full or c.ts > now() - interval '270 days')
    window w as (partition by c.symbol, c.exchange order by c.ts)
  )
  insert into public.market_leaders (day, symbol, exchange, ret126, rs_pct)
  select x.day, x.symbol, x.exchange, round(x.ret126, 6), x.rs_pct
  from (select r.*, cume_dist() over (partition by r.day order by r.ret126) as rs_pct
          from r where r.ret126 is not null) x
  where x.day >= v_from
  on conflict (day, symbol, exchange) do update set ret126 = excluded.ret126, rs_pct = excluded.rs_pct
    where (market_leaders.ret126, market_leaders.rs_pct) is distinct from (excluded.ret126, excluded.rs_pct);
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function private.refresh_leaders(boolean) from public, anon, authenticated;

-- ------------------------------------------------------------------ 3. SMA 20/50 trend
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
    busy := 0;
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
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $$;
revoke all on function private.refresh_sma_trend(text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ 4. pipeline wrapper + backstop
create or replace function public.svc_refresh_market_analytics(p_days integer default 10, p_symbols text[] default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  v_out := private.refresh_market_analytics(p_days, p_symbols);
  v_out := v_out || jsonb_build_object('setups', private.refresh_setups(p_symbols));
  v_out := v_out || jsonb_build_object('weather', private.refresh_market_weather());
  v_out := v_out || jsonb_build_object('strong_trend', private.refresh_strong_trend(p_symbols));
  v_out := v_out || jsonb_build_object('sma_trend', private.refresh_sma_trend(p_symbols));
  v_out := v_out || jsonb_build_object('dips', private.refresh_dip_rules(p_symbols));
  v_out := v_out || jsonb_build_object('graded', private.grade_signals(p_symbols));
  return v_out;
end $$;
revoke execute on function public.svc_refresh_market_analytics(integer, text[]) from public, anon, authenticated;
grant  execute on function public.svc_refresh_market_analytics(integer, text[]) to service_role;

select cron.schedule('market-analytics', '25 12 * * 1-5',
  $$ select private.refresh_market_analytics(10); select private.refresh_setups();
     select private.refresh_market_weather(); select private.refresh_strong_trend(); select private.refresh_sma_trend();
     select private.refresh_dip_rules(); select private.grade_signals(); $$);

-- Rank every stored session, build every SMA trend trade the stored candles allow, and grade them.
select private.refresh_leaders(true);
select private.refresh_sma_trend();
select private.grade_signals(null, null);
