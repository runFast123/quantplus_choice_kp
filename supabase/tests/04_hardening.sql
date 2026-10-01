-- Regression tests for the 2026-10-01 review fixes (migration 22).
-- Rolled back. Needs the dev seed (market candles + symbols).
begin;

create schema qp_t4;
create function qp_t4.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t4.expect_error(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then raise notice 'PASS [%]', p_label; return; end if;
    raise exception 'FAIL [%]: got "%"', p_label, sqlerrm;
  end;
  raise exception 'FAIL [%]: no error', p_label;
end $$;
create function qp_t4.login(p_user uuid, p_tenant uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
    'app_tenant_id', coalesce(p_tenant, (select default_tenant_id from public.profiles where user_id = p_user)))::text, true);
end $$;
grant usage on schema qp_t4 to authenticated;
grant execute on all functions in schema qp_t4 to authenticated;

-- Users: U basic, P pro, O owner of org, M admin, N member
insert into auth.users (id, email) values
  ('44444444-0000-4000-8000-000000000001', 'u@t4.test'),
  ('44444444-0000-4000-8000-000000000002', 'p@t4.test'),
  ('44444444-0000-4000-8000-000000000003', 'o@t4.test'),
  ('44444444-0000-4000-8000-000000000004', 'm@t4.test'),
  ('44444444-0000-4000-8000-000000000005', 'n@t4.test');
update public.subscriptions set plan_code = 'pro', status = 'active' where user_id = '44444444-0000-4000-8000-000000000002';

-- 1. Symbol limit can't be bypassed by UPDATE (symbol column not updatable).
select qp_t4.login('44444444-0000-4000-8000-000000000001');
set local role authenticated;
insert into public.watchlists (id) values ('44444444-0000-4000-8000-0000000000a1');
insert into public.watchlist_items (watchlist_id, symbol) values ('44444444-0000-4000-8000-0000000000a1', 'TCS');
select qp_t4.expect_error($$update public.watchlist_items set symbol = 'INFY'$$, 'permission denied', 'limit: watchlist symbol not updatable');
reset role;
select qp_t4.login('44444444-0000-4000-8000-000000000002');
set local role authenticated;
insert into public.portfolios (id) values ('44444444-0000-4000-8000-0000000000b1');
insert into public.holdings (portfolio_id, symbol, quantity, avg_price) values ('44444444-0000-4000-8000-0000000000b1', 'TCS', 1, 100);
select qp_t4.expect_error($$update public.holdings set symbol = 'INFY'$$, 'permission denied', 'limit: holding symbol not updatable');
update public.holdings set quantity = 2, avg_price = 150;
select qp_t4.check((select quantity = 2 from public.holdings), 'limit: quantity/avg still editable');
reset role;

-- 7. my_entitlements prefers a live subscription over a later-ending dead one.
insert into public.subscriptions (tenant_id, user_id, plan_code, status, source, current_period_end)
select default_tenant_id, user_id, 'pro_plus', 'cancelled', 'manual', now() + interval '2 years'
from public.profiles where user_id = '44444444-0000-4000-8000-000000000001';
select qp_t4.login('44444444-0000-4000-8000-000000000001');
set local role authenticated;
select qp_t4.check((select plan_code = 'basic' and (features ->> 'watchlist')::boolean from public.my_entitlements()),
                   'entitlements: live basic beats cancelled pro_plus');
reset role;

-- 8. Hook skips a suspended default tenant.
insert into public.tenants (id, name, slug, type) values ('44444444-0000-4000-8000-0000000000c1', 'T4 Org', 't4-org', 'organization');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('44444444-0000-4000-8000-0000000000c1', '44444444-0000-4000-8000-000000000003', 'owner'),
  ('44444444-0000-4000-8000-0000000000c1', '44444444-0000-4000-8000-000000000004', 'admin'),
  ('44444444-0000-4000-8000-0000000000c1', '44444444-0000-4000-8000-000000000005', 'member');
update public.profiles set default_tenant_id = '44444444-0000-4000-8000-0000000000c1' where user_id = '44444444-0000-4000-8000-000000000005';
update public.tenants set status = 'suspended' where id = '44444444-0000-4000-8000-0000000000c1';
select qp_t4.check(
  (select public.custom_access_token_hook(jsonb_build_object('user_id', '44444444-0000-4000-8000-000000000005', 'claims', '{}'::jsonb))
          -> 'claims' ->> 'app_tenant_id') <> '44444444-0000-4000-8000-0000000000c1',
  'hook: suspended default tenant is skipped');
update public.tenants set status = 'active' where id = '44444444-0000-4000-8000-0000000000c1';

-- Admin can remove a member but not another admin; owner can remove an admin.
insert into auth.users (id, email) values ('44444444-0000-4000-8000-000000000006', 'm2@t4.test');
insert into public.tenant_members (tenant_id, user_id, role) values ('44444444-0000-4000-8000-0000000000c1', '44444444-0000-4000-8000-000000000006', 'admin');
select qp_t4.login('44444444-0000-4000-8000-000000000004', '44444444-0000-4000-8000-0000000000c1');
set local role authenticated;
delete from public.tenant_members where tenant_id = '44444444-0000-4000-8000-0000000000c1' and user_id = '44444444-0000-4000-8000-000000000006';
reset role;
select qp_t4.check((select count(*) = 1 from public.tenant_members where tenant_id = '44444444-0000-4000-8000-0000000000c1' and user_id = '44444444-0000-4000-8000-000000000006'),
                   'members: admin cannot remove a co-admin');
select qp_t4.login('44444444-0000-4000-8000-000000000004', '44444444-0000-4000-8000-0000000000c1');
set local role authenticated;
delete from public.tenant_members where tenant_id = '44444444-0000-4000-8000-0000000000c1' and user_id = '44444444-0000-4000-8000-000000000005';
reset role;
select qp_t4.check((select count(*) = 0 from public.tenant_members where tenant_id = '44444444-0000-4000-8000-0000000000c1' and user_id = '44444444-0000-4000-8000-000000000005'),
                   'members: admin can remove a member');
select qp_t4.login('44444444-0000-4000-8000-000000000003', '44444444-0000-4000-8000-0000000000c1');
set local role authenticated;
delete from public.tenant_members where tenant_id = '44444444-0000-4000-8000-0000000000c1' and user_id = '44444444-0000-4000-8000-000000000006';
reset role;
select qp_t4.check((select count(*) = 0 from public.tenant_members where tenant_id = '44444444-0000-4000-8000-0000000000c1' and user_id = '44444444-0000-4000-8000-000000000006'),
                   'members: owner can remove an admin');

-- 9. TRUNCATE denied to clients.
select qp_t4.login('44444444-0000-4000-8000-000000000002');
set local role authenticated;
select qp_t4.expect_error('truncate public.audit_log', 'permission denied', 'grants: truncate denied');
reset role;

-- 3. A malformed signal payload doesn't abort the notifier.
create temp table lc as
  select high, low, close, ts from public.market_candles where symbol = 'TCS' and interval = '1d' order by ts desc limit 1;
insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
values ('TCS', 'NSE', 'sma_20_50_cross', 'exit', '{"close": "n/a"}', now() - interval '1 hour');
-- 5. An alert set after the session's high must not fire on that high…
insert into public.price_alerts (tenant_id, user_id, symbol, condition, trigger_price, created_at, updated_at)
select default_tenant_id, user_id, 'TCS', 'above', (select high - 0.05 from lc), (select ts from lc) - interval '1 hour', (select ts from lc) - interval '1 hour'
from public.profiles where user_id = '44444444-0000-4000-8000-000000000002';
-- 6. …and an expired plan's alert must not fire at all.
insert into public.price_alerts (tenant_id, user_id, symbol, condition, trigger_price, created_at, updated_at)
select default_tenant_id, user_id, 'TCS', 'above', (select high - 0.05 from lc), (select ts from lc) - interval '2 days', (select ts from lc) - interval '2 days'
from public.profiles where user_id = '44444444-0000-4000-8000-000000000001';
update public.subscriptions set current_period_end = now() - interval '1 day' where user_id = '44444444-0000-4000-8000-000000000001' and status = 'trialing';
-- 2. A plan ending in 3 days gets a reminder (old code only looked at day 6–7).
update public.subscriptions set current_period_end = now() + interval '3 days' where user_id = '44444444-0000-4000-8000-000000000002';

create temp table r1 as select private.run_eod_notifier() as r;
select qp_t4.check((select jsonb_array_length(r -> 'errors') = 0 from r1), 'notifier: bad payload handled, no section errors');
select qp_t4.check((select count(*) = 1 from public.notifications where user_id = '44444444-0000-4000-8000-000000000002' and type = 'exit_signal'
                    and body is not null), 'notifier: exit signal sent despite non-numeric close');
select qp_t4.check((select count(*) = 0 from public.price_alerts where user_id = '44444444-0000-4000-8000-000000000002' and status = 'triggered'),
                   'notifier: alert set after the session opened does not fire');
select qp_t4.check((select count(*) = 0 from public.price_alerts where user_id = '44444444-0000-4000-8000-000000000001' and status = 'triggered'),
                   'notifier: expired plan alerts do not fire');
select qp_t4.check((select count(*) = 1 from public.notifications where user_id = '44444444-0000-4000-8000-000000000002' and type = 'plan_expiry'),
                   'notifier: plan ending in 3 days gets a reminder');
-- Deleting notifications doesn't bring them back on the next run.
delete from public.notifications where user_id = '44444444-0000-4000-8000-000000000002';
select private.run_eod_notifier();
select qp_t4.check((select count(*) = 0 from public.notifications where user_id = '44444444-0000-4000-8000-000000000002'),
                   'notifier: dedupe survives users deleting notifications');

-- 4. Research refresh survives a zero price and a candle for an unknown symbol.
update public.market_candles set close = 0
 where symbol = 'INFY' and interval = '1d'
   and ts = (select ts from public.market_candles where symbol = 'INFY' and interval = '1d' order by ts desc offset 21 limit 1);
update public.market_symbols set is_active = false where symbol = 'WIPRO';
select qp_t4.check((select private.refresh_research_notes() > 0), 'research: refresh survives zero price + inactive symbol');

do $$ begin raise notice 'HARDENING TESTS PASSED'; end $$;
rollback;
