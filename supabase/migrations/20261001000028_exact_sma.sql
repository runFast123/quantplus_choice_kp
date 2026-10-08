-- =====================================================================
-- 5.28 Moving averages in exact decimal arithmetic.
--      On a flat price series (liquid ETFs) the 20- and 50-day averages are
--      mathematically equal; float running sums made "crosses" out of
--      rounding noise. Sums are now numeric (exact), so ties stay ties and
--      every SMA signal is reproducible. RSI is unchanged (float, rounded).
-- =====================================================================
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
      if (v_rsi[i - 1] < 30 and v_rsi[i] >= 30) or (v_rsi[i - 1] > 70 and v_rsi[i] <= 70) then
        g_strat := g_strat || 'rsi_reversal'::text;
        g_type := g_type || (case when v_rsi[i - 1] < 30 then 'buy' else 'exit' end);
        g_payload := g_payload || jsonb_build_object('close', v_c[i], 'rsi', v_rsi[i], 'prev_rsi', v_rsi[i - 1],
                                                     'stop', round(v_c[i] * 0.95, 2), 'target', round(v_c[i] * 1.08, 2));
        g_at := g_at || (v_ts[i] + interval '20 minutes');
      end if;
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
