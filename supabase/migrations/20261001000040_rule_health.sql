-- Rule health and mistake review (ADR-039). Every day each of the four rules is checked against its own tested record:
-- of its last 40 finished trades, how many made money, and is that inside the range its tested rate allows (90 %
-- binomial band)? Every losing trade gets a plain cause: the whole market fell, the stock fell on its own, or a small
-- loss (costs and noise). Nothing here changes a rule or hides a signal; a rule that leaves its range is flagged for the
-- quarterly review (PLAYBOOK §S), where any change still has to pass a test fixed in advance.

-- ------------------------------------------------------------------ 1. trades carry how they ended
-- Same view as migration 39 with the exit's result code added at the end ('STOP_HIT', 'BOUNCE', 'TIME_10', 'REVIEW_60').
create or replace view public.signal_trades
with (security_invoker = true) as
select x.strategy, x.symbol, x.exchange, x.signal_day,
       case when x.next_type = 'exit' and x.next_pnl ~ '^-?[0-9]+(\.[0-9]+)?$' then x.next_pnl::numeric end as result_pct,
       case when x.next_type = 'exit' then x.next_day end as exit_day,
       case when x.next_type = 'exit' then x.next_result end as exit_reason
from (
  select t.strategy, t.symbol, t.exchange, t.signal_type,
         coalesce(case when t.payload->>'signal_day' ~ '^\d{4}-\d{2}-\d{2}$' then (t.payload->>'signal_day')::date end,
                  (t.generated_at at time zone 'Asia/Kolkata')::date) as signal_day,
         lead(t.signal_type) over w as next_type,
         lead(t.payload->>'pnl_pct') over w as next_pnl,
         ((lead(t.generated_at) over w) at time zone 'Asia/Kolkata')::date as next_day,
         lead(t.payload->>'result') over w as next_result
  from public.trading_signals t
  where t.strategy in ('strong_trend', 'rsi_dip', 'kk_dip', 'sma_trend')
  window w as (partition by t.strategy, t.symbol, t.exchange order by t.generated_at)
) x
where x.signal_type = 'buy';

-- ------------------------------------------------------------------ 2. what each rule normally does
-- The tested record of the exact rule (research/strategies/record.py, record_sma.py, record_dip.py): Jul 2019 – Oct 2026,
-- each year's 300 most traded NSE stocks, 0.5 % round-trip cost. Same numbers as web/src/lib (STRONG_TREND_TESTED,
-- SMA_TREND_TESTED, DIP_TESTED). Update only by re-running those scripts.
create table public.rule_expectations (
  strategy   text primary key,
  made_pct   numeric not null check (made_pct > 0 and made_pct < 100),
  avg_pct    numeric not null,
  period     text not null,
  trades     integer not null check (trades > 0)
);
alter table public.rule_expectations enable row level security;
create policy rule_expectations_read on public.rule_expectations for select to authenticated using (true);
revoke insert, update, delete on public.rule_expectations from authenticated;
revoke all on public.rule_expectations from anon;
insert into public.rule_expectations (strategy, made_pct, avg_pct, period, trades) values
  ('strong_trend', 52, 5.7,  'Jul 2019 – Oct 2026', 2008),
  ('sma_trend',    52, 5.6,  'Jul 2019 – Oct 2026', 1221),
  ('rsi_dip',      64, 0.67, 'Jul 2019 – Oct 2026', 3058),
  ('kk_dip',       68, 0.77, 'Jul 2019 – Oct 2026', 1070);

-- ------------------------------------------------------------------ 3. the mistake review
-- Every finished trade that did not beat the 0.5 % cost, with the Nifty 500's move over the same days and one cause:
--   small  = lost under 1.5 % after costs (costs and day-to-day noise),
--   market = the Nifty 500 fell 3 % or more over the trade (the whole market fell),
--   stock  = otherwise (the stock fell on its own).
create view public.rule_mistakes
with (security_invoker = true) as
select tr.strategy, tr.symbol, tr.exchange, tr.signal_day, tr.exit_day, tr.exit_reason,
       round(tr.result_pct - 0.5, 2) as net_pct,
       round(m.move, 2)              as market_pct,
       case when tr.result_pct - 0.5 > -1.5 then 'small'
            when m.move <= -3 then 'market'
            else 'stock' end         as cause
from public.signal_trades tr
left join lateral (
  select 100 * (b.close / nullif(a.close, 0) - 1) as move
  from (select c.close from public.market_candles c
         where c.symbol = 'NIFTY500' and c.exchange = 'NSE' and c.interval = '1d'
           and (c.ts at time zone 'Asia/Kolkata')::date <= tr.signal_day
         order by c.ts desc limit 1) a,
       (select c.close from public.market_candles c
         where c.symbol = 'NIFTY500' and c.exchange = 'NSE' and c.interval = '1d'
           and (c.ts at time zone 'Asia/Kolkata')::date <= tr.exit_day
         order by c.ts desc limit 1) b
) m on true
where tr.result_pct is not null and tr.result_pct <= 0.5;
revoke all on public.rule_mistakes from anon, public;
grant select on public.rule_mistakes to authenticated;

-- ------------------------------------------------------------------ 4. the daily health snapshot
create table public.rule_health (
  strategy     text not null references public.rule_expectations (strategy),
  day          date not null,
  trades       integer not null,           -- finished trades in the window (at most 40)
  made         integer not null,           -- of them, how many beat the 0.5 % cost
  made_pct     numeric,
  expected_pct numeric not null,
  low_pct      numeric not null,           -- the 90 % range the tested rate allows for this many trades
  high_pct     numeric not null,
  avg_pct      numeric,                    -- average result after costs
  status       text not null check (status in ('below', 'within', 'above', 'too_few')),
  causes       jsonb not null default '{}',  -- losing trades in the window by cause: {"market": n, "stock": n, "small": n}
  first_exit   date,
  last_exit    date,
  computed_at  timestamptz not null default now(),
  primary key (strategy, day)
);
alter table public.rule_health enable row level security;
create policy rule_health_read on public.rule_health for select to authenticated using (true);
revoke insert, update, delete on public.rule_health from authenticated;
revoke all on public.rule_health from anon;

-- One row per rule for p_day: the last 40 trades that finished on or before it.
create or replace function private.refresh_rule_health(p_day date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_day  date := coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date);
  v_rows integer;
begin
  with w as (
    select tr.strategy, tr.symbol, tr.signal_day, tr.exit_day, tr.result_pct,
           row_number() over (partition by tr.strategy order by tr.exit_day desc, tr.signal_day desc, tr.symbol desc) as k
    from public.signal_trades tr
    where tr.result_pct is not null and tr.exit_day <= v_day
  ), last40 as (
    select w.*, mk.cause
    from w
    left join public.rule_mistakes mk
      on mk.strategy = w.strategy and mk.symbol = w.symbol and mk.signal_day = w.signal_day
    where w.k <= 40
  ), agg as (
    select e.strategy, e.made_pct as expected,
           count(l.result_pct)::int                              as n,
           count(*) filter (where l.result_pct > 0.5)::int       as made,
           round(avg(l.result_pct - 0.5), 2)                     as avg_pct,
           min(l.exit_day) as first_exit, max(l.exit_day) as last_exit,
           jsonb_build_object(
             'market', count(*) filter (where l.cause = 'market'),
             'stock',  count(*) filter (where l.cause = 'stock'),
             'small',  count(*) filter (where l.cause = 'small')) as causes
    from public.rule_expectations e
    left join last40 l on l.strategy = e.strategy
    group by e.strategy, e.made_pct
  )
  insert into public.rule_health (strategy, day, trades, made, made_pct, expected_pct, low_pct, high_pct, avg_pct,
                                  status, causes, first_exit, last_exit, computed_at)
  select a.strategy, v_day, a.n, a.made,
         case when a.n > 0 then round(100.0 * a.made / a.n, 1) end,
         a.expected, b.low, b.high, a.avg_pct,
         case when a.n < 20 then 'too_few'
              when 100.0 * a.made / a.n < b.low then 'below'
              when 100.0 * a.made / a.n > b.high then 'above'
              else 'within' end,
         a.causes, a.first_exit, a.last_exit, now()
  from agg a
  cross join lateral (
    select round(greatest(0, a.expected - 164.5 * sqrt((a.expected / 100) * (1 - a.expected / 100) / greatest(a.n, 1))), 1) as low,
           round(least(100, a.expected + 164.5 * sqrt((a.expected / 100) * (1 - a.expected / 100) / greatest(a.n, 1))), 1) as high
  ) b
  on conflict (strategy, day) do update
    set trades = excluded.trades, made = excluded.made, made_pct = excluded.made_pct,
        expected_pct = excluded.expected_pct, low_pct = excluded.low_pct, high_pct = excluded.high_pct,
        avg_pct = excluded.avg_pct, status = excluded.status, causes = excluded.causes,
        first_exit = excluded.first_exit, last_exit = excluded.last_exit, computed_at = now();
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function private.refresh_rule_health(date) from public, anon, authenticated;

-- ------------------------------------------------------------------ 5. runs with the daily checks
create or replace function public.svc_refresh_signal_checks(p_full boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  v_out := jsonb_build_object('breadth', private.refresh_market_breadth(p_full));
  v_out := v_out || jsonb_build_object('trend', private.refresh_trend_checks());
  v_out := v_out || jsonb_build_object('rsi', private.refresh_rsi_checks());
  v_out := v_out || jsonb_build_object('training', private.refresh_check_training());
  v_out := v_out || jsonb_build_object('health', private.refresh_rule_health());
  return v_out;
end $$;
revoke execute on function public.svc_refresh_signal_checks(boolean) from public, anon, authenticated;
grant  execute on function public.svc_refresh_signal_checks(boolean) to service_role;

-- A year of weekly history so the trend line has something to show from day one.
select private.refresh_rule_health(d::date)
from generate_series((now() at time zone 'Asia/Kolkata')::date - 364, (now() at time zone 'Asia/Kolkata')::date, interval '7 days') d;
select private.refresh_rule_health();
