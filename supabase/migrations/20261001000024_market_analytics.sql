-- =====================================================================
-- 5.24 Real end-of-day data (ADR-026). pipelines/eod (yfinance) upserts
--      daily candles with the service role, then calls:
--        svc_refresh_market_analytics(days)  RSI(14, Wilder), SMA 20/50,
--                                            signals, SIP backtest ledgers
--        svc_refresh_research()              (5.17)
--        svc_run_eod_notifier()              alerts / exit signals / expiry
--      Everything here is derived only from market_candles, so the dev
--      seed calls the same function — one implementation of each
--      indicator, real or synthetic.
-- =====================================================================

-- Signals are append-only and must be stable: the notifier dedupes exit
-- signals by id (private.notification_ledger). A natural key lets the
-- refresh re-run safely; existing rows are never deleted or rewritten.
delete from public.trading_signals a
 using public.trading_signals b
 where a.id > b.id and a.symbol = b.symbol and a.exchange = b.exchange
   and a.strategy = b.strategy and a.signal_type = b.signal_type and a.generated_at = b.generated_at;
create unique index if not exists trading_signals_natural_key
  on public.trading_signals (symbol, exchange, strategy, signal_type, generated_at);

-- p_days: how far back to (re)write RSI events and add missing signals.
-- Indicators are always computed over the full daily history, so a short
-- window gives the same values as a full rebuild.
create or replace function private.refresh_market_analytics(p_days integer default 10) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_since   timestamptz := now() - make_interval(days => greatest(p_days, 1));
  v_rsi     integer;
  v_signals integer;
  v_ledgers integer;
  r         record;
  v_key     text := '';
  v_prev    numeric;
  v_gain    numeric;
  v_loss    numeric;
  v_n       integer;
begin
  drop table if exists pg_temp._qp_ind;
  create temp table _qp_ind on commit drop as
  select c.symbol, c.exchange, c.ts, c.close,
         row_number() over w as n,
         avg(c.close) over (w rows between 19 preceding and current row) as sma20,
         avg(c.close) over (w rows between 49 preceding and current row) as sma50,
         null::numeric as rsi
  from public.market_candles c
  join public.market_symbols s on s.symbol = c.symbol and s.exchange = c.exchange and s.is_active
  where c.interval = '1d'
  window w as (partition by c.symbol, c.exchange order by c.ts);
  create index on _qp_ind (symbol, exchange, ts);

  -- Wilder's RSI(14): seed with the simple mean of the first 14 moves,
  -- then smooth (prev × 13 + current) / 14 — what charting platforms show.
  for r in select symbol, exchange, ts, close from _qp_ind order by symbol, exchange, ts loop
    if r.symbol || '|' || r.exchange <> v_key then
      v_key := r.symbol || '|' || r.exchange;
      v_prev := r.close; v_gain := 0; v_loss := 0; v_n := 0;
      continue;
    end if;
    v_n := v_n + 1;
    if v_n <= 14 then
      v_gain := v_gain + greatest(r.close - v_prev, 0) / 14;
      v_loss := v_loss + greatest(v_prev - r.close, 0) / 14;
    else
      v_gain := (v_gain * 13 + greatest(r.close - v_prev, 0)) / 14;
      v_loss := (v_loss * 13 + greatest(v_prev - r.close, 0)) / 14;
    end if;
    v_prev := r.close;
    if v_n >= 14 then
      update _qp_ind set rsi = case when v_loss = 0 then 100
                                    else round(100 - 100 / (1 + v_gain / v_loss), 2) end
       where symbol = r.symbol and exchange = r.exchange and ts = r.ts;
    end if;
  end loop;

  drop table if exists pg_temp._qp_ind2;
  create temp table _qp_ind2 on commit drop as
  select i.*,
         lag(i.rsi)   over w as prev_rsi,
         lag(i.sma20) over w as prev_sma20,
         lag(i.sma50) over w as prev_sma50
  from _qp_ind i
  window w as (partition by i.symbol, i.exchange order by i.ts);

  insert into public.rsi_events (symbol, exchange, ts, rsi, event_type)
  select symbol, exchange, ts, rsi,
         case when rsi < 30 and coalesce(prev_rsi, 50) >= 30 then 'oversold_cross'
              when rsi > 70 and coalesce(prev_rsi, 50) <= 70 then 'overbought_cross'
              else 'daily' end
  from _qp_ind2
  where rsi is not null and ts >= v_since
  on conflict (symbol, exchange, ts) do update
    set rsi = excluded.rsi, event_type = excluded.event_type;
  get diagnostics v_rsi = row_count;

  with ins as (
    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select symbol, exchange, 'sma_20_50_cross',
           case when sma20 > sma50 then 'buy' else 'exit' end,
           jsonb_build_object('close', close, 'sma20', round(sma20, 2), 'sma50', round(sma50, 2),
                              'stop', round(close * 0.93, 2), 'target', round(close * 1.12, 2)),
           ts + interval '15 minutes'
    from _qp_ind2
    where n > 50 and ts >= v_since
      and ((sma20 > sma50 and prev_sma20 <= prev_sma50) or (sma20 < sma50 and prev_sma20 >= prev_sma50))
    union all
    select symbol, exchange, 'rsi_reversal',
           case when prev_rsi < 30 then 'buy' else 'exit' end,
           jsonb_build_object('close', close, 'rsi', rsi, 'prev_rsi', prev_rsi,
                              'stop', round(close * 0.95, 2), 'target', round(close * 1.08, 2)),
           ts + interval '20 minutes'
    from _qp_ind2
    where ts >= v_since and ((prev_rsi < 30 and rsi >= 30) or (prev_rsi > 70 and rsi <= 70))
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing
    returning 1
  )
  select count(*) into v_signals from ins;

  -- Monthly ₹10,000 SIP from the first candle, valued at the latest close.
  insert into public.backtest_ledgers (symbol, exchange, ledger, roi_pct, computed_at)
  with firsts as (
    select distinct on (symbol, exchange, date_trunc('month', ts at time zone 'Asia/Kolkata'))
           symbol, exchange, ts, close
    from _qp_ind
    order by symbol, exchange, date_trunc('month', ts at time zone 'Asia/Kolkata'), ts
  ),
  buys as (
    select symbol, exchange, ts, close,
           round(10000 / close, 4) as units,
           sum(round(10000 / close, 4)) over w as running_units,
           count(*) over w * 10000 as invested
    from firsts
    where close > 0
    window w as (partition by symbol, exchange order by ts)
  ),
  lastp as (
    select distinct on (symbol, exchange) symbol, exchange, close as last_close
    from _qp_ind
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
  group by b.symbol, b.exchange, l.last_close
  on conflict (symbol, exchange) do update
    set ledger = excluded.ledger, roi_pct = excluded.roi_pct, computed_at = excluded.computed_at;
  get diagnostics v_ledgers = row_count;

  drop table if exists pg_temp._qp_ind2;
  drop table if exists pg_temp._qp_ind;
  return jsonb_build_object('rsi_events', v_rsi, 'signals', v_signals, 'ledgers', v_ledgers);
end $$;
revoke all on function private.refresh_market_analytics(integer) from public, anon, authenticated;

create or replace function public.svc_refresh_market_analytics(p_days integer default 10) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select private.refresh_market_analytics(p_days)
$$;
revoke execute on function public.svc_refresh_market_analytics(integer) from public, anon, authenticated;
grant  execute on function public.svc_refresh_market_analytics(integer) to service_role;

create or replace function public.svc_run_eod_notifier() returns jsonb
language sql volatile security definer set search_path = '' as $$
  select private.run_eod_notifier()
$$;
revoke execute on function public.svc_run_eod_notifier() from public, anon, authenticated;
grant  execute on function public.svc_run_eod_notifier() to service_role;

-- The pipeline runs at 17:00 IST and calls everything itself. The pg_cron
-- passes stay as idempotent backstops, moved after it (18:00 / 18:05 IST);
-- a later notifier run finds nothing new because of the ledger.
select cron.schedule('market-analytics', '25 12 * * 1-5', $$ select private.refresh_market_analytics(10) $$);
select cron.schedule('eod-notifier',     '30 12 * * 1-5', $$ select private.run_eod_notifier() $$);
select cron.schedule('research-notes',   '35 12 * * 1-5', $$ select private.refresh_research_notes() $$);
