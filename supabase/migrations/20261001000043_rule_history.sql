-- ADR-041: about 3.4 years of daily candles (1,250 days) for the 500 largest companies and the indices the rules read,
-- so the five rules have their warm-up (up to 300 sessions) before the chart's window and show their past signals.
-- With two years stored (ADR-034), the first year was spent warming up: 200-day trend's first possible signal was
-- January 2026, Strong trend's October 2025. ~+45 MB on the free tier (330 MB before).
--
-- After this migration the candles are back-filled once (pipelines/eod/eod.py --symbols <top 500 + indices> --days 1250)
-- and the five rules are rebuilt (supabase/scripts/rebuild-rules.mjs, which calls private.rebuild_rule_signals in batches).

-- ------------------------------------------------------------------ 1. how much history is kept
-- Migration 26 capped history_days at 1,000.
alter table public.market_symbols drop constraint if exists market_symbols_history_days_check;
alter table public.market_symbols add constraint market_symbols_history_days_check check (history_days between 30 and 2000);

create or replace function private.history_for_rank()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.mcap_rank is not null and new.mcap_rank <= 500 and new.history_days < 1250 then
    new.history_days := 1250;
  end if;
  return new;
end $$;
revoke all on function private.history_for_rank() from public, anon, authenticated;

update public.market_symbols
   set history_days = 1250
 where (mcap_rank <= 500 or symbol in ('NIFTY', 'NIFTY500', 'INDIAVIX')) and history_days < 1250;

-- ------------------------------------------------------------------ 2. rebuild the five rules for some stocks
-- Each rule keeps one trade per stock, so signals written on a shorter history can overlap a trade that the longer
-- history now opens earlier. This deletes the five rules' signals for the stocks (their grades go with them) and runs
-- every rule again on everything stored, then the latest signal and the grades. A signal the rebuild writes again
-- (same stock, rule, type and time) gets its old id back, so notifications already sent for it are not sent twice.
-- Call refresh_leaders(true) and refresh_market_weather(true) first, and the signal checks and rule health after the
-- last batch.
create or replace function private.rebuild_rule_signals(p_symbols text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_del  integer;
  v_kept integer;
  v_out  jsonb;
begin
  if p_symbols is null or cardinality(p_symbols) = 0 then
    raise exception 'rebuild_rule_signals needs a list of symbols';
  end if;
  drop table if exists pg_temp.rebuild_old;
  create temporary table rebuild_old on commit drop as
    select t.id, t.symbol, t.exchange, t.strategy, t.signal_type, t.generated_at
    from public.trading_signals t
    where t.symbol = any(p_symbols) and t.strategy in (select e.strategy from public.rule_expectations e);
  delete from public.trading_signals t using pg_temp.rebuild_old o where t.id = o.id;
  get diagnostics v_del = row_count;
  v_out := jsonb_build_object('deleted', v_del);
  v_out := v_out || jsonb_build_object('strong_trend', private.refresh_strong_trend(p_symbols));
  v_out := v_out || jsonb_build_object('sma_trend', private.refresh_sma_trend(p_symbols));
  v_out := v_out || jsonb_build_object('ma200_trend', private.refresh_ma200_trend(p_symbols));
  v_out := v_out || jsonb_build_object('dips', private.refresh_dip_rules(p_symbols));

  -- Written again: the same row under its old id.
  drop table if exists pg_temp.rebuild_same;
  create temporary table rebuild_same on commit drop as
    select o.id as old_id, n.id as new_id, n.symbol, n.exchange, n.strategy, n.signal_type, n.payload, n.generated_at
    from public.trading_signals n
    join pg_temp.rebuild_old o
      on o.symbol = n.symbol and o.exchange = n.exchange and o.strategy = n.strategy
     and o.signal_type = n.signal_type and o.generated_at = n.generated_at
    where n.symbol = any(p_symbols);
  delete from public.trading_signals t using pg_temp.rebuild_same s where t.id = s.new_id;
  insert into public.trading_signals (id, symbol, exchange, strategy, signal_type, payload, generated_at)
  overriding system value
  select s.old_id, s.symbol, s.exchange, s.strategy, s.signal_type, s.payload, s.generated_at from pg_temp.rebuild_same s;
  get diagnostics v_kept = row_count;
  v_out := v_out || jsonb_build_object('same_id', v_kept);
  v_out := v_out || jsonb_build_object('last_signal', private.refresh_last_signal(p_symbols));
  v_out := v_out || jsonb_build_object('graded', private.grade_signals(p_symbols, null));
  return v_out;
end $$;
revoke all on function private.rebuild_rule_signals(text[]) from public, anon, authenticated;
