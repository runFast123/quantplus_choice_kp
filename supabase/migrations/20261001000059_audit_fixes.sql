-- System audit fixes (9 Nov 2026): faster signal lists, and the price guard's review findings (database and security
-- reviews of migrations 57-58).

-- ------------------------------------------------------------------ 1. signal lists
-- The Signals page reads the newest 200 signals (of one rule, of the six, or of all); trading_signals had indexes by
-- stock only, so each read sorted the whole table (66k rows, 32 MB with payloads): 0.7-0.8 s when the table is not in
-- memory (the free plan's cache is small), up to 7.7 s under load; 7-22 ms once cached. One rule's list now reads
-- (strategy, generated_at desc); the six rules' and the full list read (generated_at desc) newest first and stop at 200.
create index if not exists trading_signals_strategy_time_idx on public.trading_signals (strategy, generated_at desc);
create index if not exists trading_signals_time_idx on public.trading_signals (generated_at desc);
analyze public.trading_signals;

-- ------------------------------------------------------------------ 2. price guard
create index if not exists candle_checks_day_idx on public.candle_checks (day);

-- The flags an admin can review and the stock page explains: the 500 largest companies (the rules' stocks), and only
-- days still stored (a re-downloaded or trimmed history can leave a flag behind).
create view public.candle_checks_review
with (security_invoker = true) as
select k.symbol, k.exchange, k.day, k.prev_close, k.open, k.high, k.low, k.close, k.bad_open, k.bad_high, k.bad_low,
       k.status, k.found_at, k.reviewed_at
from public.candle_checks k
join public.market_symbols s on s.symbol = k.symbol and s.exchange = k.exchange and s.mcap_rank <= 500
where exists (select 1 from public.market_candles m
               where m.symbol = k.symbol and m.exchange = k.exchange and m.interval = k.interval and m.ts = k.ts);
revoke all on public.candle_checks_review from anon, public;
grant select on public.candle_checks_review to authenticated;

-- A market-wide day needs the market itself to have fallen: 3+ of the 500 largest flagged AND the NIFTY 50's low at
-- least 3 % under its close the day before (5 of 842 stored sessions; 4 Jun 2024 -8.5 %, 7 Apr 2025 -5.1 %). Before,
-- any 3 flags made a day 'market', so a vendor glitch across a few stocks would have passed as real (23 Jan 2024, the
-- NIFTY's low -2.0 %, was one). Flags whose candle is gone don't count. One writer at a time (two overlapping price loads
-- could each see fewer than 3).
create or replace function private.mark_market_days(p_days date[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
  v_back integer;
begin
  perform pg_advisory_xact_lock(hashtext('private.mark_market_days'));
  drop table if exists pg_temp.market_wide;
  create temporary table market_wide on commit drop as
    select k.day
    from public.candle_checks k
    join public.market_symbols s on s.symbol = k.symbol and s.exchange = k.exchange
    where k.day = any(p_days) and s.mcap_rank <= 500
      and exists (select 1 from public.market_candles m
                   where m.symbol = k.symbol and m.exchange = k.exchange and m.interval = k.interval and m.ts = k.ts)
    group by k.day
    having count(*) >= 3
       and exists (
         select 1 from public.market_candles n
         cross join lateral (select p.close from public.market_candles p
                              where p.symbol = 'NIFTY' and p.exchange = 'NSE' and p.interval = '1d' and p.ts < n.ts
                              order by p.ts desc limit 1) pv
         where n.symbol = 'NIFTY' and n.exchange = 'NSE' and n.interval = '1d'
           and (n.ts at time zone 'Asia/Kolkata')::date = k.day
           and n.low <= 0.97 * pv.close);
  update public.candle_checks k set status = 'market', reviewed_at = null
   where k.status = 'suspect' and k.day in (select w.day from pg_temp.market_wide w);
  get diagnostics v_rows = row_count;
  update public.candle_checks k set status = 'suspect'
   where k.status = 'market' and k.day = any(p_days) and k.day not in (select w.day from pg_temp.market_wide w);
  get diagnostics v_back = row_count;
  return v_rows + v_back;
end $$;
revoke all on function private.mark_market_days(date[]) from public, anon, authenticated;

-- A review that changes what the rules read rebuilds the stock's rules (migration 58) and now also its signal
-- conditions: the old rows belonged to buys that were just rewritten, and their gap, close location and ATR read the
-- day's prices.
create or replace function public.svc_review_candle(p_symbol text, p_exchange text, p_day date, p_status text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_old  text;
  v_new  text;
  v_out  jsonb := '{}'::jsonb;
begin
  if p_status is null or p_status not in ('suspect', 'real', 'bad') then
    raise exception 'INVALID_INPUT';
  end if;
  select k.status into v_old from public.candle_checks k
   where k.symbol = p_symbol and k.exchange::text = p_exchange and k.interval = '1d' and k.day = p_day
   for update;
  if v_old is null then raise exception 'NOT_FOUND'; end if;
  update public.candle_checks k
     set status = p_status, reviewed_at = case when p_status = 'suspect' then null else now() end
   where k.symbol = p_symbol and k.exchange::text = p_exchange and k.interval = '1d' and k.day = p_day;
  if p_status = 'suspect' then
    perform private.mark_market_days(array[p_day]);
  end if;
  select k.status into v_new from public.candle_checks k
   where k.symbol = p_symbol and k.exchange::text = p_exchange and k.interval = '1d' and k.day = p_day;
  if (v_old in ('real', 'market')) is distinct from (v_new in ('real', 'market'))
     and exists (select 1 from public.market_symbols s
                  where s.symbol = p_symbol and s.exchange::text = p_exchange and s.mcap_rank <= 500) then
    v_out := private.rebuild_rule_signals(array[p_symbol]);
    delete from public.signal_conditions c where c.symbol = p_symbol and c.exchange::text = p_exchange;
    v_out := v_out || jsonb_build_object('conditions', private.refresh_signal_conditions(array[p_symbol]));
  end if;
  return jsonb_build_object('status', v_new, 'was', v_old, 'rebuilt', v_out <> '{}'::jsonb) || v_out;
end $$;
revoke execute on function public.svc_review_candle(text, text, date, text) from public, anon, authenticated;
grant  execute on function public.svc_review_candle(text, text, date, text) to service_role;

-- Every stored flag under the new rule. A day that is no longer market-wide (live: 23 Jan 2024, 4 flags) puts its
-- stocks' prices back under the guard, so those stocks' rules and conditions are worked out again here.
do $$
declare
  v_syms text[];
begin
  create temporary table market_before on commit drop as
    select k.symbol, k.exchange, k.day, k.status from public.candle_checks k where k.status = 'market';
  perform private.mark_market_days(array(select distinct k.day from public.candle_checks k));
  select array_agg(distinct b.symbol) into v_syms
  from pg_temp.market_before b
  join public.candle_checks k on k.symbol = b.symbol and k.exchange = b.exchange and k.day = b.day
  join public.market_symbols s on s.symbol = b.symbol and s.exchange = b.exchange and s.mcap_rank <= 500
  where k.status <> 'market';
  if v_syms is not null then
    perform private.rebuild_rule_signals(v_syms);
    delete from public.signal_conditions c where c.symbol = any(v_syms);
    perform private.refresh_signal_conditions(v_syms);
  end if;
end $$;
