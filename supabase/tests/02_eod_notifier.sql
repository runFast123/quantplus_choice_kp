-- End-of-day notifier: alerts trigger once, exit signals notify holders once.
-- Runs in a rolled-back transaction; needs the dev seed (market candles).
begin;

create schema qp_t2;
create function qp_t2.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not p_ok then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;

insert into auth.users (id, email) values ('bbbbbbbb-0000-4000-8000-0000000000f9', 'eod@test.quantspulse.local');
update public.subscriptions set plan_code = 'pro', status = 'active'
 where user_id = 'bbbbbbbb-0000-4000-8000-0000000000f9';

-- Latest candle for TCS sets the levels.
create temp table lc as
  select high, low, close, ts from public.market_candles
  where symbol = 'TCS' and interval = '1d' order by ts desc limit 1;

insert into public.portfolios (id, tenant_id, user_id)
select 'bbbbbbbb-0000-4000-8000-0000000000fa', default_tenant_id, user_id
from public.profiles where user_id = 'bbbbbbbb-0000-4000-8000-0000000000f9';
insert into public.holdings (tenant_id, user_id, portfolio_id, symbol, quantity, avg_price)
select default_tenant_id, user_id, 'bbbbbbbb-0000-4000-8000-0000000000fa', 'TCS', 5, 100
from public.profiles where user_id = 'bbbbbbbb-0000-4000-8000-0000000000f9';

insert into public.price_alerts (tenant_id, user_id, symbol, condition, trigger_price, created_at)
select p.default_tenant_id, p.user_id, 'TCS', c.cond, c.px, (select ts from lc) - interval '1 day'
from public.profiles p,
     (values ('above'::public.alert_condition, (select high - 0.05 from lc)),   -- should trigger
             ('below'::public.alert_condition, (select low  - 50   from lc)))   -- should not
       as c(cond, px)
where p.user_id = 'bbbbbbbb-0000-4000-8000-0000000000f9';

insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
values ('TCS', 'NSE', 'sma_20_50_cross', 'exit', '{"close": 3500}', now() - interval '2 hours');

select private.run_eod_notifier();

select qp_t2.check((select count(*) from public.price_alerts
                    where user_id = 'bbbbbbbb-0000-4000-8000-0000000000f9' and status = 'triggered') = 1,
                   'eod: crossed alert triggered, other still armed');
select qp_t2.check((select count(*) from public.notifications
                    where user_id = 'bbbbbbbb-0000-4000-8000-0000000000f9' and type = 'price_alert') = 1,
                   'eod: one price_alert notification');
select qp_t2.check((select count(*) from public.notifications
                    where user_id = 'bbbbbbbb-0000-4000-8000-0000000000f9' and type = 'exit_signal') = 1,
                   'eod: holder notified of exit signal');

select private.run_eod_notifier();
select qp_t2.check((select count(*) from public.notifications
                    where user_id = 'bbbbbbbb-0000-4000-8000-0000000000f9') = 2,
                   'eod: second run is idempotent');

do $$ begin raise notice 'EOD NOTIFIER TESTS PASSED'; end $$;
rollback;
