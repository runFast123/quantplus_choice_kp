-- Price guard: market-wide days count as real (ADR-053, amended 9 Nov 2026).
-- The rebuild preview after migration 57 showed the guard setting aside two real market crashes: 4 Jun 2024 (election
-- results: 9 of the 500 largest companies flagged, lows 15-25 % under the close before, back by the close) and 7 Apr 2025
-- (tariffs: 32 flagged). A bad Yahoo price is one stock's: 56 of the other flagged days among the 500 largest have one
-- company, 4 have two, one has three (23 Jan 2024, a rail-stock sell-off). So: when 3 or more of the 500 largest companies
-- are flagged on the same day, it was the market, and every flag of that day gets status 'market', which the rules read
-- like 'real'. Decided from those dates, not from any rule's result. An admin can still mark any of them bad.

alter table public.candle_checks drop constraint candle_checks_status_check;
alter table public.candle_checks add constraint candle_checks_status_check
  check (status in ('suspect', 'real', 'bad', 'market'));

create or replace view private.trusted_candles as
select c.symbol, c.exchange, c.interval, c.ts,
       case when k.bad_open then c.close else c.open end as open,
       case when k.bad_high then greatest(case when k.bad_open then c.close else c.open end, c.close) else c.high end as high,
       case when k.bad_low then least(case when k.bad_open then c.close else c.open end, c.close) else c.low end as low,
       c.close, c.volume
from public.market_candles c
left join public.candle_checks k
  on k.symbol = c.symbol and k.exchange = c.exchange and k.interval = c.interval and k.ts = c.ts
 and k.status not in ('real', 'market');
revoke all on private.trusted_candles from public, anon, authenticated;

-- Days with 3+ flagged companies among the 500 largest: their unreviewed flags become 'market'; a day that no longer
-- has 3 (a revision) goes back to 'suspect'. Admin reviews ('real', 'bad') are kept.
create or replace function private.mark_market_days(p_days date[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
  v_back integer;
begin
  with wide as (
    select k.day
    from public.candle_checks k
    join public.market_symbols s on s.symbol = k.symbol and s.exchange = k.exchange
    where k.day = any(p_days) and s.mcap_rank <= 500
    group by k.day
    having count(*) >= 3
  )
  update public.candle_checks k set status = 'market', reviewed_at = null
   where k.status = 'suspect' and k.day in (select w.day from wide w);
  get diagnostics v_rows = row_count;
  update public.candle_checks k set status = 'suspect'
   where k.status = 'market' and k.day = any(p_days)
     and (select count(*) from public.candle_checks x
            join public.market_symbols s on s.symbol = x.symbol and s.exchange = x.exchange
           where x.day = k.day and s.mcap_rank <= 500) < 3;
  get diagnostics v_back = row_count;
  return v_rows + v_back;
end $$;
revoke all on function private.mark_market_days(date[]) from public, anon, authenticated;

-- Migration 57's check, then the market-wide test for the days it touched.
create or replace function private.check_candle_days(p_symbols text[], p_exchanges text[], p_ts timestamptz[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  with ch as (
    select distinct x.symbol, x.exchange::public.exchange_code as exchange, x.ts
    from unnest(p_symbols, p_exchanges, p_ts) as x(symbol, exchange, ts)
  ),
  tg as (
    select ch.symbol, ch.exchange, ch.ts from ch
    union
    select ch.symbol, ch.exchange, nx.ts
    from ch
    cross join lateral (
      select c.ts from public.market_candles c
      where c.symbol = ch.symbol and c.exchange = ch.exchange and c.interval = '1d' and c.ts > ch.ts
      order by c.ts limit 1
    ) nx
  ),
  ev as (
    select tg.symbol, tg.exchange, tg.ts, c.open, c.high, c.low, c.close, pv.close as pc
    from tg
    join public.market_candles c
      on c.symbol = tg.symbol and c.exchange = tg.exchange and c.interval = '1d' and c.ts = tg.ts
    cross join lateral (
      select p.close from public.market_candles p
      where p.symbol = tg.symbol and p.exchange = tg.exchange and p.interval = '1d' and p.ts < tg.ts
      order by p.ts desc limit 1
    ) pv
    where pv.close > 0
  ),
  fl as (
    select ev.*,
           ev.open < 0.88 * least(ev.pc, ev.close) or ev.open > 1.12 * greatest(ev.pc, ev.close) as bo,
           ev.high > 1.12 * greatest(ev.pc, ev.close) as bh,
           ev.low < 0.88 * least(ev.pc, ev.close) as bl
    from ev
  ),
  gone as (
    delete from public.candle_checks k
    using tg
    where k.symbol = tg.symbol and k.exchange = tg.exchange and k.interval = '1d' and k.ts = tg.ts
      and not exists (select 1 from fl where fl.symbol = k.symbol and fl.exchange = k.exchange and fl.ts = k.ts
                                         and (fl.bo or fl.bh or fl.bl))
    returning 1
  )
  insert into public.candle_checks (symbol, exchange, interval, ts, day, prev_close, open, high, low, close,
                                    bad_open, bad_high, bad_low)
  select fl.symbol, fl.exchange, '1d', fl.ts, (fl.ts at time zone 'Asia/Kolkata')::date, fl.pc,
         fl.open, fl.high, fl.low, fl.close, fl.bo, fl.bh, fl.bl
  from fl
  where fl.bo or fl.bh or fl.bl
  on conflict (symbol, exchange, interval, ts) do update
    set prev_close = excluded.prev_close, open = excluded.open, high = excluded.high, low = excluded.low,
        close = excluded.close, bad_open = excluded.bad_open, bad_high = excluded.bad_high, bad_low = excluded.bad_low,
        status = 'suspect', found_at = now(), reviewed_at = null
    where (candle_checks.prev_close, candle_checks.open, candle_checks.high, candle_checks.low, candle_checks.close)
          is distinct from (excluded.prev_close, excluded.open, excluded.high, excluded.low, excluded.close);
  get diagnostics v_rows = row_count;
  -- the days written and each one's next session (the same days the check above looked at)
  perform private.mark_market_days(array(
    select distinct (x.ts at time zone 'Asia/Kolkata')::date from unnest(p_ts) as x(ts)
    union
    select distinct (nx.ts at time zone 'Asia/Kolkata')::date
    from unnest(p_symbols, p_exchanges, p_ts) as x(symbol, exchange, ts)
    cross join lateral (
      select m.ts from public.market_candles m
      where m.symbol = x.symbol and m.exchange::text = x.exchange and m.interval = '1d' and m.ts > x.ts
      order by m.ts limit 1
    ) nx));
  return v_rows;
end $$;
revoke all on function private.check_candle_days(text[], text[], timestamptz[]) from public, anon, authenticated;

-- A review: 'market' reads like 'real'; undoing a review re-runs the market-wide test for that day. The stock's rules
-- are worked out again when what they read changes.
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
  end if;
  return jsonb_build_object('status', v_new, 'was', v_old, 'rebuilt', v_out <> '{}'::jsonb) || v_out;
end $$;
revoke execute on function public.svc_review_candle(text, text, date, text) from public, anon, authenticated;
grant  execute on function public.svc_review_candle(text, text, date, text) to service_role;

-- Every stored flag once; then the conditions of buys on or after a market day of their stock again (their gap, close
-- location and ATR read that day's prices).
select private.mark_market_days(array(select distinct k.day from public.candle_checks k));
delete from public.signal_conditions sc
 where exists (select 1 from public.candle_checks k
                where k.status = 'market' and k.symbol = sc.symbol and k.exchange = sc.exchange
                  and k.day <= sc.signal_day);
select private.refresh_signal_conditions();
