-- Stay-in Plan (17 Nov 2026, ADR-060): an optional exit for holders of a stock a trend rule bought. Tested in
-- research/strategies/stay_in.py (pre-registered): holding until the first close below the 200-day average, with the
-- rule's own safety stop, beat the trend rules' 60-session plan in a 10-slot portfolio in 2019-23 (30.5 % a year vs
-- 24.2 %) and in the 2024-26 check (19.6 % vs 15.5 %), worst fall within 5 points. The rules' own plans are unchanged.
--   1. notification_prefs.stay_in (off by default): the holder's choice to be messaged when the plan sells.
--   2. plan key stay_in on Pro and Pro Plus (AGENTS rule 12); the notifier checks it like price alerts.
--   3. private.run_eod_notifier: as migration 57, plus the stay-in block and a 'stay_in' count in its report.

alter table public.notification_prefs add column if not exists stay_in boolean not null default false;
-- Users change only their choices (migration 50 grants update per column); RLS keeps it to their own row.
grant update (stay_in) on public.notification_prefs to authenticated;

update public.plans
   set features = features || '{"stay_in": true}'::jsonb
 where code in ('pro', 'pro_plus');

-- private.run_eod_notifier: migration 57's, plus the Stay-in Plan block before the report
CREATE OR REPLACE FUNCTION private.run_eod_notifier()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_alerts  integer := 0;
  v_signals integer := 0;
  v_expiry  integer := 0;
  v_adjust  integer := 0;
  v_stay    integer := 0;
  v_errors  text[]  := '{}';
begin
  begin
    v_adjust := private.ledger_maintenance();
  exception when others then
    v_errors := v_errors || ('corporate_actions: ' || sqlerrm);
  end;

  begin
    with latest as (
      select distinct on (c.symbol, c.exchange) c.symbol, c.exchange, c.high, c.low, c.close, c.ts
      from private.trusted_candles c
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
         and l.ts - interval '6 hours 15 minutes' > a.updated_at
         and ((a.condition = 'above' and l.high >= a.trigger_price)
           or (a.condition = 'below' and l.low  <= a.trigger_price))
         and coalesce((select (p.features ->> 'alerts')::boolean from public.plans p
                        where p.code = private.effective_plan(a.user_id, a.tenant_id)), false)
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
  exception when others then
    v_errors := v_errors || ('price_alerts: ' || sqlerrm);
  end;

  begin
    with recent as (
      select s.id, s.symbol, s.exchange, s.strategy, s.payload ->> 'result' as how,
             private.try_numeric(s.payload ->> 'close') as at
      from public.trading_signals s
      where s.signal_type = 'exit' and s.generated_at > now() - interval '4 days'
    ),
    holders as (
      select distinct h.tenant_id, h.user_id, r.id as signal_id, r.symbol, r.strategy, r.how, r.at
      from recent r
      join public.holdings h on h.symbol = r.symbol and h.exchange = r.exchange and h.quantity > 0
      left join public.notification_prefs p on p.user_id = h.user_id and p.tenant_id = h.tenant_id
      where r.strategy = any (coalesce(p.exit_rules, array['strong_trend', 'sma_trend', 'ma200_trend']))
    ),
    fresh as (
      insert into private.notification_ledger (user_id, tenant_id, kind, ref)
      select x.user_id, x.tenant_id, 'exit_signal', x.signal_id::text from holders x
      on conflict do nothing
      returning user_id, tenant_id, ref
    ),
    ins as (
      insert into public.notifications (tenant_id, user_id, type, title, body, data)
      select x.tenant_id, x.user_id, 'exit_signal',
             private.rule_label(x.strategy) || ' closed its trade in ' || x.symbol,
             case x.how when 'STOP_HIT' then 'Its safety stop was hit'
                        when 'BOUNCE'   then 'It sold on the bounce'
                        when 'TIME'     then 'Its time limit passed'
                        else 'It closed its trade' end
               || coalesce(' at ₹' || to_char(x.at, 'FM999G99G99G990D00'), '')
               || '. This is the rule''s own research trade, not advice. Your holding is unchanged.',
             jsonb_build_object('signal_id', x.signal_id, 'symbol', x.symbol, 'strategy', x.strategy)
      from holders x
      join fresh f on f.user_id = x.user_id and f.tenant_id = x.tenant_id and f.ref = x.signal_id::text
      returning 1
    )
    select count(*) into v_signals from ins;
  exception when others then
    v_errors := v_errors || ('exit_signals: ' || sqlerrm);
  end;

  begin
    with due as (
      select s.tenant_id, s.user_id, s.id, s.status, s.current_period_end
      from public.subscriptions s
      where s.status in ('trialing', 'active')
        and s.current_period_end > now()
        and s.current_period_end <= now() + interval '7 days'
    ),
    fresh as (
      insert into private.notification_ledger (user_id, tenant_id, kind, ref)
      select d.user_id, d.tenant_id, 'plan_expiry', d.id::text || ':' || d.current_period_end::text from due d
      on conflict do nothing
      returning user_id, tenant_id, ref
    ),
    ins as (
      insert into public.notifications (tenant_id, user_id, type, title, body, data)
      select d.tenant_id, d.user_id, 'plan_expiry',
             case when d.status = 'trialing' then 'Your trial ends soon' else 'Your plan ends soon' end,
             'It ends on ' || to_char(d.current_period_end at time zone 'Asia/Kolkata', 'DD Mon YYYY')
               || '. Renew from Plan & billing to keep your radar, alerts and portfolio running.',
             jsonb_build_object('subscription_id', d.id, 'period_end', d.current_period_end)
      from due d
      join fresh f on f.user_id = d.user_id and f.tenant_id = d.tenant_id
                  and f.ref = d.id::text || ':' || d.current_period_end::text
      returning 1
    )
    select count(*) into v_expiry from ins;
  exception when others then
    v_errors := v_errors || ('plan_expiry: ' || sqlerrm);
  end;

  -- Stay-in Plan (migration 61, ADR-060): for holders who switched it on and whose plan includes it, the first close
  -- below the 200-day average after the latest trend-rule buy in the stock (or that buy's safety stop, if reached
  -- first) ends the Stay-in Plan's trade. One message per buy (notification_ledger 'stay_in').
  begin
    with held as (
      select distinct h.tenant_id, h.user_id, h.symbol, h.exchange
      from public.holdings h
      join public.notification_prefs p on p.user_id = h.user_id and p.tenant_id = h.tenant_id and p.stay_in
      where h.quantity > 0
        and coalesce((select (pl.features ->> 'stay_in')::boolean from public.plans pl
                       where pl.code = private.effective_plan(h.user_id, h.tenant_id)), false)
    ),
    buys as (
      select distinct on (x.symbol, x.exchange) x.symbol, x.exchange, s.id as signal_id,
             (s.generated_at at time zone 'Asia/Kolkata')::date as signal_day,
             private.try_numeric(s.payload ->> 'stop') as stop
      from (select distinct symbol, exchange from held) x
      join public.trading_signals s on s.symbol = x.symbol and s.exchange = x.exchange
      where s.signal_type = 'buy' and s.strategy in ('strong_trend', 'sma_trend', 'ma200_trend', 'secular_trend')
      order by x.symbol, x.exchange, s.generated_at desc
    ),
    series as (
      select b.symbol, b.exchange, b.signal_id, b.signal_day, b.stop, c.ts, c.low, c.close,
             avg(c.close) over w as sma200, count(*) over w as n200
      from buys b
      join private.trusted_candles c on c.symbol = b.symbol and c.exchange = b.exchange and c.interval = '1d'
                                    and c.ts >= b.signal_day - interval '330 days'
      window w as (partition by b.symbol, b.exchange order by c.ts rows between 199 preceding and current row)
    ),
    ended as (
      select distinct on (x.symbol, x.exchange) x.symbol, x.exchange, x.signal_id, x.ts, x.close, x.sma200, x.stop,
             case when x.stop is not null and x.low <= x.stop then 'stop' else 'ma200' end as how
      from series x
      where (x.ts at time zone 'Asia/Kolkata')::date > x.signal_day
        and ((x.stop is not null and x.low <= x.stop) or (x.n200 = 200 and x.close < x.sma200))
      order by x.symbol, x.exchange, x.ts
    ),
    today as (
      select e.* from ended e
      where e.ts > now() - interval '4 days'
        and e.ts = (select max(c.ts) from private.trusted_candles c
                     where c.symbol = e.symbol and c.exchange = e.exchange and c.interval = '1d')
    ),
    targets as (
      select h.tenant_id, h.user_id, t.* from today t join held h on h.symbol = t.symbol and h.exchange = t.exchange
    ),
    fresh as (
      insert into private.notification_ledger (user_id, tenant_id, kind, ref)
      select x.user_id, x.tenant_id, 'stay_in', x.signal_id::text from targets x
      on conflict do nothing
      returning user_id, tenant_id, ref
    ),
    ins as (
      insert into public.notifications (tenant_id, user_id, type, title, body, data)
      select x.tenant_id, x.user_id, 'exit_signal',
             case x.how when 'stop' then 'Stay-in Plan: ' || x.symbol || ' reached its safety stop'
                        else 'Stay-in Plan: ' || x.symbol || ' closed below its 200-day average' end,
             case x.how when 'stop' then 'The low reached the safety stop of ₹' || to_char(x.stop, 'FM999G99G99G990D00')
                                         || ' set at the trend rule''s buy.'
                        else 'Closed at ₹' || to_char(x.close, 'FM999G99G99G990D00') || ', under its 200-day average of ₹'
                               || to_char(x.sma200, 'FM999G99G99G990D00') || '.' end
               || ' The Stay-in Plan, a tested research plan, sells here. Not advice; your holding is unchanged.',
             jsonb_build_object('signal_id', x.signal_id, 'symbol', x.symbol, 'plan', 'stay_in', 'how', x.how)
      from targets x
      join fresh f on f.user_id = x.user_id and f.tenant_id = x.tenant_id and f.ref = x.signal_id::text
      returning 1
    )
    select count(*) into v_stay from ins;
  exception when others then
    v_errors := v_errors || ('stay_in: ' || sqlerrm);
  end;

  return jsonb_build_object('holding_adjustments', v_adjust, 'price_alerts', v_alerts, 'exit_signals', v_signals,
                            'plan_expiry', v_expiry, 'stay_in', v_stay, 'errors', to_jsonb(v_errors));
end $function$;
revoke all on function private.run_eod_notifier() from public, anon, authenticated;
