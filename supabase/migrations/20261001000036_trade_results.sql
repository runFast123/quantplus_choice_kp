-- Each rule's record by its own plan (ADR-036 follow-up). public.strategy_scorecard grades every entry by the move 20
-- sessions later, which fits Strong trend but not the dip rules: they sell on the bounce, usually within 5 sessions.
-- public.strategy_trade_results sums each rule's closed trades as the rule itself closed them: an exit (or a KK cover)
-- paired with the entry before it. The result is the exit's stored pnl_pct (Strong trend, the dip rules, KK), otherwise
-- the move from the entry's close to the exit's close; an exit counts only when the rule's previous signal on that
-- stock was its entry (RSI reversal's exits did not always follow a buy). Before costs, like the scorecard.

create view public.strategy_trade_results
with (security_invoker = true) as
select x.strategy, x.side,
       count(*)                                                      as trades,
       round(100.0 * count(*) filter (where x.result_pct > 0) / count(*), 1) as made_money_pct,
       round(avg(x.result_pct), 2)                                   as avg_result_pct,
       round(avg(x.result_pct) filter (where x.result_pct > 0), 2)   as avg_win_pct,
       round(avg(x.result_pct) filter (where x.result_pct <= 0), 2)  as avg_loss_pct,
       min(x.day)                                                    as first_day,
       max(x.day)                                                    as last_day
from (
  select e.strategy,
         case when e.payload->>'action' = 'cover' then 'short' else 'long' end as side,
         (e.generated_at at time zone 'Asia/Kolkata')::date as day,
         coalesce(
           case when e.payload->>'pnl_pct' ~ '^-?[0-9.]+$' then (e.payload->>'pnl_pct')::numeric end,
           case when p.signal_type = 'buy' and coalesce(p.payload->>'action', 'buy') = 'buy'
                     and p.payload->>'close' ~ '^[0-9.]+$' and e.payload->>'close' ~ '^[0-9.]+$'
                     and (p.payload->>'close')::numeric > 0
                then ((e.payload->>'close')::numeric / (p.payload->>'close')::numeric - 1) * 100 end
         ) as result_pct
  from public.trading_signals e
  -- the same rule's signal on that stock just before this exit
  left join lateral (
    select b.signal_type, b.payload from public.trading_signals b
    where b.symbol = e.symbol and b.exchange = e.exchange and b.strategy = e.strategy and b.generated_at < e.generated_at
    order by b.generated_at desc limit 1
  ) p on true
  where e.signal_type = 'exit' and coalesce(e.payload->>'action', 'exit') in ('exit', 'cover')
) x
where x.result_pct is not null
group by x.strategy, x.side;
revoke all on public.strategy_trade_results from anon, public;
grant select on public.strategy_trade_results to authenticated;
