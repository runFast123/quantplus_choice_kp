-- strategy_trade_results, made fair and fast (replaces migration 36's body; same columns).
--  * Pairing an exit with "the buy before it" is only fair when a rule's buys and exits alternate. SMA 20/50 crosses do.
--    RSI reversal's do not: its exit fires only after a rally to RSI 70, so buys that kept falling never got an exit and
--    pairing counted only the winners (98.6 % "made money" on the live data). RSI reversal therefore has no trade result
--    here; its 20-session grades stay in strategy_scorecard.
--  * Rules that store their result on the exit (Strong trend, RSI dip, KK dip, KK's imported trades) use it as is.
--  * One window pass instead of a lookup per exit: ~4 s became well under a second on the live data.

create or replace view public.strategy_trade_results
with (security_invoker = true) as
with stored as (
  select t.strategy,
         case when t.payload->>'action' = 'cover' then 'short' else 'long' end as side,
         (t.generated_at at time zone 'Asia/Kolkata')::date as day,
         (t.payload->>'pnl_pct')::numeric as result_pct
  from public.trading_signals t
  where t.signal_type = 'exit' and coalesce(t.payload->>'action', 'exit') in ('exit', 'cover')
    and t.payload->>'pnl_pct' ~ '^-?[0-9]+(\.[0-9]+)?$'
),
paired as (                         -- SMA 20/50: each exit closes the buy just before it
  select s.strategy, 'long'::text as side, s.day, s.result_pct
  from (
    select t.strategy, t.signal_type, (t.generated_at at time zone 'Asia/Kolkata')::date as day,
           lag(t.signal_type) over w as prev_type,
           ((t.payload->>'close')::numeric / nullif((lag(t.payload->>'close') over w)::numeric, 0) - 1) * 100 as result_pct
    from public.trading_signals t
    where t.strategy = 'sma_20_50_cross'
    window w as (partition by t.symbol, t.exchange order by t.generated_at)
  ) s
  where s.signal_type = 'exit' and s.prev_type = 'buy'
),
x as (select * from stored union all select * from paired)
select x.strategy, x.side,
       count(*)                                                      as trades,
       round(100.0 * count(*) filter (where x.result_pct > 0) / count(*), 1) as made_money_pct,
       round(avg(x.result_pct), 2)                                   as avg_result_pct,
       round(avg(x.result_pct) filter (where x.result_pct > 0), 2)   as avg_win_pct,
       round(avg(x.result_pct) filter (where x.result_pct <= 0), 2)  as avg_loss_pct,
       min(x.day)                                                    as first_day,
       max(x.day)                                                    as last_day
from x
where x.result_pct is not null
group by x.strategy, x.side;
revoke all on public.strategy_trade_results from anon, public;
grant select on public.strategy_trade_results to authenticated;
