-- Stay-in Plan (migration 61): the off-by-default choice, the plan key, and the notifier's message on the first close
-- below the 200-day average after a trend-rule buy (or its safety stop, if reached first). Rolled back.
begin;

create schema qp_t30;
create function qp_t30.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t30.login(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
    'app_tenant_id', (select default_tenant_id from public.profiles where user_id = p_user))::text, true);
end $$;
-- Daily candles ending today (IST): k = 0 is today and closes at p_last; every earlier day closes at p_flat. On day
-- p_low_day (if given) the whole bar trades at p_low (a real fall: a low spike alone is set aside by the price guard).
create function qp_t30.candles(p_symbol text, p_flat numeric, p_last numeric, p_low_day integer default null, p_low numeric default null)
returns void language sql as $$
  insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
  select p_symbol, 'NSE', '1d',
         ((now() at time zone 'Asia/Kolkata')::date - k)::timestamp at time zone 'Asia/Kolkata',
         x.c, x.c, x.c, x.c, 1000
  from generate_series(259, 0, -1) as k,
       lateral (select case when k = 0 then p_last when k = p_low_day then p_low else p_flat end as c) x
$$;
grant usage on schema qp_t30 to authenticated;
grant execute on all functions in schema qp_t30 to authenticated;

insert into public.market_symbols (symbol, exchange, name, is_active) values
  ('QPSTAY', 'NSE', 'Stay-in fixture', true),
  ('QPSTOP', 'NSE', 'Stay-in stop fixture', true),
  ('QPHOLD', 'NSE', 'Stay-in above fixture', true);
-- QPSTAY closes under its 200-day average today; QPSTOP reached its safety stop 5 days ago (that ended its Stay-in
-- trade) and also closes under the average today; QPHOLD stays above it.
select qp_t30.candles('QPSTAY', 150, 90);
select qp_t30.candles('QPSTOP', 150, 90, 5, 45);
select qp_t30.candles('QPHOLD', 150, 155);
insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
select s, 'NSE', 'sma_trend', 'buy', '{"close": 150, "stop": 50}', now() - interval '30 days'
from unnest(array['QPSTAY', 'QPSTOP', 'QPHOLD']) s;

-- A (Pro) turns the plan on; B (Pro) leaves it off; C (now Basic) turns it on but the plan lacks it. All hold all three.
insert into auth.users (id, email) values
  ('30303030-0000-4000-8000-00000000000a', 'a@t30.test'),
  ('30303030-0000-4000-8000-00000000000b', 'b@t30.test'),
  ('30303030-0000-4000-8000-00000000000c', 'c@t30.test');
-- C holds on Pro and then moves to Basic (Basic allows no portfolio, so it can't add holdings itself).
update public.subscriptions set plan_code = 'pro', status = 'active' where user_id::text like '30303030-%';
insert into public.portfolios (id, tenant_id, user_id)
select ('30303030-0000-4000-8000-0000000001' || right(user_id::text, 2))::uuid, default_tenant_id, user_id
from public.profiles where user_id::text like '30303030-%';
insert into public.holdings (tenant_id, user_id, portfolio_id, symbol, quantity, avg_price)
select p.default_tenant_id, p.user_id, ('30303030-0000-4000-8000-0000000001' || right(p.user_id::text, 2))::uuid, s, 10, 150
from public.profiles p, unnest(array['QPSTAY', 'QPSTOP', 'QPHOLD']) s
where p.user_id::text like '30303030-%';
update public.subscriptions set plan_code = 'basic' where user_id = '30303030-0000-4000-8000-00000000000c';

select qp_t30.check((select count(*) = 0 from public.notification_prefs where user_id::text like '30303030-%'),
                    'off by default: no choice saved, so no messages');
select qp_t30.check((select (features ->> 'stay_in')::boolean from public.plans where code = 'pro')
                and (select (features ->> 'stay_in')::boolean from public.plans where code = 'pro_plus')
                and (select not (features ? 'stay_in') from public.plans where code = 'basic'),
                    'plan key: Pro and Pro Plus, not Basic');
select qp_t30.check((select column_default = 'false' from information_schema.columns
                     where table_schema = 'public' and table_name = 'notification_prefs' and column_name = 'stay_in'),
                    'the column defaults to off');

-- The choice is saved through the table's own rules (RLS), by each user for themself.
select qp_t30.login('30303030-0000-4000-8000-00000000000a');
set local role authenticated;
insert into public.notification_prefs (stay_in) values (true);
reset role;
select qp_t30.login('30303030-0000-4000-8000-00000000000c');
set local role authenticated;
insert into public.notification_prefs (stay_in) values (true);
reset role;
select qp_t30.check((select count(*) = 2 from public.notification_prefs where user_id::text like '30303030-%' and stay_in),
                    'A and C chose it themselves');
-- and can change it again: the settings form saves with an upsert (insert ... on conflict do update).
select qp_t30.login('30303030-0000-4000-8000-00000000000c');
set local role authenticated;
insert into public.notification_prefs (stay_in) values (true) on conflict (user_id, tenant_id) do update set stay_in = excluded.stay_in;
reset role;
select qp_t30.check((select stay_in from public.notification_prefs where user_id = '30303030-0000-4000-8000-00000000000c'),
                    'the settings upsert can change the choice');

create temp table r1 as select private.run_eod_notifier() as r;
select qp_t30.check((select jsonb_array_length(r -> 'errors') = 0 and (r ->> 'stay_in')::int = 1 from r1),
                    'notifier: one Stay-in message, no errors');
select qp_t30.check((select count(*) = 1 from public.notifications
                     where user_id = '30303030-0000-4000-8000-00000000000a' and data ->> 'plan' = 'stay_in'
                       and data ->> 'symbol' = 'QPSTAY' and data ->> 'how' = 'ma200'
                       and title = 'Stay-in Plan: QPSTAY closed below its 200-day average'
                       and body like 'Closed at ₹90.00, under its 200-day average of ₹149.70.%Not advice; your holding is unchanged.'),
                    'A is told, in plain numbers, when QPSTAY closes under its 200-day average');
select qp_t30.check((select count(*) = 0 from public.notifications where data ->> 'symbol' in ('QPSTOP', 'QPHOLD') and data ->> 'plan' = 'stay_in'),
                    'no message for a trade the stop ended earlier, nor for a stock still above the average');
select qp_t30.check((select count(*) = 0 from public.notifications
                     where user_id in ('30303030-0000-4000-8000-00000000000b', '30303030-0000-4000-8000-00000000000c')
                       and data ->> 'plan' = 'stay_in'),
                    'nothing for B (left it off) or C (Basic plan)');

select private.run_eod_notifier();
select qp_t30.check((select count(*) = 1 from public.notifications where data ->> 'plan' = 'stay_in'),
                    'a second run sends nothing again');

-- Isolation: B cannot see or change A's choice.
select qp_t30.login('30303030-0000-4000-8000-00000000000b');
set local role authenticated;
select qp_t30.check((select count(*) = 0 from public.notification_prefs), 'isolation: B sees no one else''s choice');
update public.notification_prefs set stay_in = false where user_id = '30303030-0000-4000-8000-00000000000a';
reset role;
select qp_t30.check((select stay_in from public.notification_prefs where user_id = '30303030-0000-4000-8000-00000000000a'),
                    'isolation: B cannot change A''s choice');

do $$ begin raise notice 'STAY-IN TESTS PASSED'; end $$;
rollback;
