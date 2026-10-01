-- =====================================================================
-- 5.17 End-of-day notifier (not in the original spec).
--      Until the live tick worker exists, alerts and exit signals are
--      evaluated against each session's daily candle after the close.
--      Runs as the job owner via pg_cron; never callable from the API.
-- =====================================================================

create or replace function private.run_eod_notifier() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_alerts  integer := 0;
  v_signals integer := 0;
  v_expiry  integer := 0;
begin
  -- 1) Price alerts vs. the latest daily candle's high/low (catches intraday crosses).
  with latest as (
    select distinct on (c.symbol, c.exchange) c.symbol, c.exchange, c.high, c.low, c.close, c.ts
    from public.market_candles c
    where c.interval = '1d' and c.ts > now() - interval '7 days'
    order by c.symbol, c.exchange, c.ts desc
  ),
  hit as (
    update public.price_alerts a
       set status = 'triggered',
           triggered_at = now(),
           triggered_price = case when a.condition = 'above' then greatest(a.trigger_price, l.close)
                                  else least(a.trigger_price, l.close) end
      from latest l
     where a.status = 'armed'
       and l.symbol = a.symbol and l.exchange = a.exchange
       and l.ts > a.created_at
       and ((a.condition = 'above' and l.high >= a.trigger_price)
         or (a.condition = 'below' and l.low  <= a.trigger_price))
    returning a.id, a.tenant_id, a.user_id, a.symbol, a.condition, a.trigger_price, l.close
  ),
  ins as (
    insert into public.notifications (tenant_id, user_id, type, title, body, data)
    select h.tenant_id, h.user_id, 'price_alert',
           h.symbol || ' crossed ' || case when h.condition = 'above' then 'above ' else 'below ' end
             || '₹' || to_char(h.trigger_price, 'FM999G99G99G990D00'),
           'Closed at ₹' || to_char(h.close, 'FM999G99G99G990D00') || '. The alert is now off; set a new level if you still care.',
           jsonb_build_object('alert_id', h.id, 'symbol', h.symbol)
    from hit h
    returning 1
  )
  select count(*) into v_alerts from ins;

  -- 2) Exit signals on stocks a user holds (once per signal per user per tenant).
  with recent as (
    select s.id, s.symbol, s.exchange, s.strategy, (s.payload ->> 'close')::numeric as at
    from public.trading_signals s
    where s.signal_type = 'exit' and s.generated_at > now() - interval '36 hours'
  ),
  holders as (
    select distinct h.tenant_id, h.user_id, r.id as signal_id, r.symbol, r.strategy, r.at
    from recent r
    join public.holdings h on h.symbol = r.symbol and h.exchange = r.exchange and h.quantity > 0
  ),
  ins as (
    insert into public.notifications (tenant_id, user_id, type, title, body, data)
    select x.tenant_id, x.user_id, 'exit_signal',
           'Exit signal on ' || x.symbol,
           case x.strategy when 'sma_20_50_cross' then 'The 20-day average closed below the 50-day'
                           when 'rsi_reversal'   then 'RSI turned down from overbought'
                           else x.strategy end
             || ' at ₹' || to_char(x.at, 'FM999G99G99G990D00') || '. You hold this stock.',
           jsonb_build_object('signal_id', x.signal_id, 'symbol', x.symbol)
    from holders x
    where not exists (
      select 1 from public.notifications n
      where n.user_id = x.user_id and n.tenant_id = x.tenant_id
        and n.type = 'exit_signal' and n.data ->> 'signal_id' = x.signal_id::text
    )
    returning 1
  )
  select count(*) into v_signals from ins;

  -- 3) Plan expiry reminder, 7 days out, once per period.
  with due as (
    select s.tenant_id, s.user_id, s.id, s.plan_code, s.status, s.current_period_end
    from public.subscriptions s
    where s.status in ('trialing', 'active')
      and s.current_period_end between now() + interval '6 days' and now() + interval '7 days'
  ),
  ins as (
    insert into public.notifications (tenant_id, user_id, type, title, body, data)
    select d.tenant_id, d.user_id, 'plan_expiry',
           case when d.status = 'trialing' then 'Your trial ends in 7 days' else 'Your plan renews in 7 days' end,
           'Renew from Plan & billing to keep your radar, alerts and portfolio running.',
           jsonb_build_object('subscription_id', d.id, 'period_end', d.current_period_end)
    from due d
    where not exists (
      select 1 from public.notifications n
      where n.user_id = d.user_id and n.type = 'plan_expiry'
        and n.data ->> 'subscription_id' = d.id::text
        and n.data ->> 'period_end' = to_jsonb(d.current_period_end) #>> '{}'
    )
    returning 1
  )
  select count(*) into v_expiry from ins;

  return jsonb_build_object('price_alerts', v_alerts, 'exit_signals', v_signals, 'plan_expiry', v_expiry);
end $$;

revoke all on function private.run_eod_notifier() from public, anon, authenticated;

-- 16:15 IST (10:45 UTC), Monday–Friday — after pipelines write the day's candle.
select cron.schedule('eod-notifier', '45 10 * * 1-5', $$ select private.run_eod_notifier() $$);
