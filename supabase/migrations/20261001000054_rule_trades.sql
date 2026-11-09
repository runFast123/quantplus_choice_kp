-- Step D (ADR-050): the live rules' trades as buy → sale pairs, for "your trades next to the rules' trades".
-- Market data only, no user rows. The entry is the real fill stored by grading (signal_outcomes, migration 33): the
-- next session's open for the trend rules, the limit fill for the dip rules. The sale is the next exit row of the same
-- rule and stock, before that rule's next buy (one trade per stock at a time). A trade without an exit yet is open
-- (exit columns null). exit_entry_fill is the entry as the exit row recorded it, in the share basis of the exit day, so
-- exit_price / exit_entry_fill is the trade's result even when a split fell inside it.
-- security_invoker: the caller's read rights on trading_signals and signal_outcomes apply (signed-in users only).
create view public.rule_trades
with (security_invoker = true) as
select o.signal_id,
       o.strategy,
       o.symbol,
       o.exchange,
       o.signal_day,
       o.entry_day,
       o.entry_price,
       x.exit_day,
       x.exit_price,
       x.exit_entry_fill,
       x.result,
       x.label as exit_label
from public.signal_outcomes o
join public.trading_signals b on b.id = o.signal_id
left join lateral (
  select (t.generated_at at time zone 'Asia/Kolkata')::date as exit_day,
         case when t.payload->>'exit_price' ~ '^[0-9]+(\.[0-9]+)?$' then (t.payload->>'exit_price')::numeric end as exit_price,
         case when t.payload->>'entry_fill' ~ '^[0-9]+(\.[0-9]+)?$' then (t.payload->>'entry_fill')::numeric end as exit_entry_fill,
         t.payload->>'result' as result,
         t.payload->>'label' as label
  from public.trading_signals t
  where t.symbol = o.symbol and t.exchange = o.exchange and t.strategy = o.strategy
    and t.signal_type = 'exit' and t.generated_at > b.generated_at
    and not exists (
      select 1 from public.trading_signals n
      where n.symbol = o.symbol and n.exchange = o.exchange and n.strategy = o.strategy
        and n.signal_type = 'buy' and n.generated_at > b.generated_at and n.generated_at < t.generated_at
    )
  order by t.generated_at
  limit 1
) x on true
where o.side = 'long'
  and o.strategy in ('strong_trend', 'sma_trend', 'ma200_trend', 'rsi_dip', 'kk_dip');

comment on view public.rule_trades is
  'The five live rules'' trades: entry (signal_outcomes) paired with the next exit before the next buy. Market data only.';

revoke all on public.rule_trades from anon, public;
grant select on public.rule_trades to authenticated;
