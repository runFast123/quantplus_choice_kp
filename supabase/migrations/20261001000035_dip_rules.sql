-- RSI and KK, fixed (ADR-036): two "dip in an uptrend" rules replace RSI reversal and the KK breakout import.
--
-- Research (research/strategies/improve*.py, record_dip.py; 2019-2026, each year's 300 most traded stocks, rules
-- chosen on 2019-23 and checked on 2024-26, 0.5 % cost): today's RSI reversal and KK buys lost money and were
-- wrong 58-63 % of the time, mostly by buying falling stocks with fixed % levels. The fixes buy a short, sharp dip
-- only in a stock above its 200-day average, only at a lower price the next day, and sell into the first bounce.
--   rsi_dip  RSI(2) < 10 (EWM, alpha 1/2) and the close above the 200-day average
--   kk_dip   the low 1 % or more under the lowest low of the previous 20 sessions, close above the 200-day average
--   plan     the next session only: a buy at limit = close - 1 x ATR14 (EWM, alpha 1/14, rounded to paise), filled
--            when that day's low trades 0.2 % through it, at min(open, limit); sell at the first close above the
--            5-day average, else the close of the 10th session; safety stop entry - 5 x ATR14 (filled at the stop,
--            or the open if it gaps under). One trade at a time per stock and rule. The 500 largest companies.
-- Stored like the other rules: a 'buy' on the fill day (payload.fill = the entry, so the grader uses it) and an
-- 'exit' when it closes. The pending dip-buy level for the next session lives in public.signal_watch.
-- RSI reversal stops producing signals (its block is removed from refresh_market_analytics below); its stored
-- signals and grades stay as history, like KK's imported trades (which ended 24 Aug 2026). KK shorts have no
-- replacement: no tested version made money after costs (improve_short.py).

-- ------------------------------------------------------------------ 1. analytics without RSI reversal signals
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
      if i > 50 and ((s20[i] > s50[i] and s20[i - 1] <= s50[i - 1]) or (s20[i] < s50[i] and s20[i - 1] >= s50[i - 1])) then
        g_strat := g_strat || 'sma_20_50_cross'::text;
        g_type := g_type || (case when s20[i] > s50[i] then 'buy' else 'exit' end);
        g_payload := g_payload || jsonb_build_object('close', v_c[i], 'sma20', round(s20[i]::numeric, 2), 'sma50', round(s50[i]::numeric, 2),
                                                     'stop', round(v_c[i] * 0.93, 2), 'target', round(v_c[i] * 1.12, 2));
        g_at := g_at || (v_ts[i] + interval '15 minutes');
      end if;
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

-- ------------------------------------------------------------------ 2. pending dip-buy levels
create table public.signal_watch (
  symbol      text not null,
  exchange    public.exchange_code not null,
  strategy    text not null,
  signal_day  date not null,
  limit_price numeric not null check (limit_price > 0),
  stop        numeric not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  primary key (symbol, exchange, strategy)
);
alter table public.signal_watch enable row level security;
create policy signal_watch_read on public.signal_watch for select to authenticated using (true);
revoke insert, update, delete on public.signal_watch from authenticated;
revoke all on public.signal_watch from anon;

-- ------------------------------------------------------------------ 3. the two dip rules
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
      busy := 0;
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
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $$;
revoke all on function private.refresh_dip_rules(text[]) from public, anon, authenticated;

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
  v_out := v_out || jsonb_build_object('dips', private.refresh_dip_rules(p_symbols));
  v_out := v_out || jsonb_build_object('graded', private.grade_signals(p_symbols));
  return v_out;
end $$;
revoke execute on function public.svc_refresh_market_analytics(integer, text[]) from public, anon, authenticated;
grant  execute on function public.svc_refresh_market_analytics(integer, text[]) to service_role;

select cron.schedule('market-analytics', '25 12 * * 1-5',
  $$ select private.refresh_market_analytics(10); select private.refresh_setups();
     select private.refresh_market_weather(); select private.refresh_strong_trend(); select private.refresh_dip_rules();
     select private.grade_signals(); $$);

-- Build every dip trade the stored candles allow, today's dip-buy levels, and grade them.
select private.refresh_dip_rules();
select private.grade_signals(null, null);
