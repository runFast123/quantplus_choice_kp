-- Holdings you can trust (migration 50): split and bonus adjustments with undo, exit messages that name the rule and
-- follow each person's choice of rules, and isolation of the two new user tables. Rolled back.
begin;

create schema qp_t20;
create function qp_t20.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t20.expect_error(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then raise notice 'PASS [%]', p_label; return; end if;
    raise exception 'FAIL [%]: got "%"', p_label, sqlerrm;
  end;
  raise exception 'FAIL [%]: no error', p_label;
end $$;
create function qp_t20.login(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
    'app_tenant_id', (select default_tenant_id from public.profiles where user_id = p_user))::text, true);
end $$;
grant usage on schema qp_t20 to authenticated;
grant execute on all functions in schema qp_t20 to authenticated;

-- A holds TCS (entered long ago), INFY (edited after the split) and WIPRO; B holds TCS and wants only KK dip messages;
-- C holds nothing.
insert into auth.users (id, email) values
  ('20202020-0000-4000-8000-00000000000a', 'a@t20.test'),
  ('20202020-0000-4000-8000-00000000000b', 'b@t20.test'),
  ('20202020-0000-4000-8000-00000000000c', 'c@t20.test');
update public.subscriptions set plan_code = 'pro', status = 'active'
 where user_id in ('20202020-0000-4000-8000-00000000000a', '20202020-0000-4000-8000-00000000000b', '20202020-0000-4000-8000-00000000000c');

insert into public.portfolios (id, tenant_id, user_id)
select ('20202020-0000-4000-8000-0000000001' || right(user_id::text, 2))::uuid, default_tenant_id, user_id
from public.profiles where user_id in ('20202020-0000-4000-8000-00000000000a', '20202020-0000-4000-8000-00000000000b');

insert into public.holdings (tenant_id, user_id, portfolio_id, symbol, quantity, avg_price, created_at, updated_at)
select p.default_tenant_id, p.user_id, ('20202020-0000-4000-8000-0000000001' || right(p.user_id::text, 2))::uuid,
       h.sym, h.q, h.px, h.at, h.at
from public.profiles p,
     (values ('20202020-0000-4000-8000-00000000000a'::uuid, 'TCS',   10::numeric, 3000::numeric, now() - interval '10 days'),
             ('20202020-0000-4000-8000-00000000000a'::uuid, 'INFY',  40, 750, now()),
             ('20202020-0000-4000-8000-00000000000a'::uuid, 'WIPRO', 7,  100, now() - interval '10 days'),
             ('20202020-0000-4000-8000-00000000000b'::uuid, 'TCS',   4,  3200, now() - interval '10 days')) as h(uid, sym, q, px, at)
where p.user_id = h.uid;

-- Two days ago: TCS and INFY split 1:2, WIPRO gave a 1:2 bonus (3 shares for every 2).
insert into public.corporate_actions (symbol, exchange, ex_date, factor) values
  ('TCS',   'NSE', (now() at time zone 'Asia/Kolkata')::date - 2, 2),
  ('INFY',  'NSE', (now() at time zone 'Asia/Kolkata')::date - 2, 2),
  ('WIPRO', 'NSE', (now() at time zone 'Asia/Kolkata')::date - 2, 1.5);

create temp table sig as
with ins as (
  insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at) values
    ('TCS', 'NSE', 'sma_trend', 'exit', '{"close": 3500, "result": "STOP_HIT"}', now() - interval '3 hours'),
    ('TCS', 'NSE', 'kk_dip',    'exit', '{"close": 3510, "result": "BOUNCE"}',   now() - interval '3 hours')
  returning id, strategy
) select * from ins;

-- B chooses KK dip only, through the table's own rules.
select qp_t20.login('20202020-0000-4000-8000-00000000000b');
set local role authenticated;
insert into public.notification_prefs (exit_rules) values (array['kk_dip']);
reset role;

create temp table r1 as select private.run_eod_notifier() as r;
select qp_t20.check((select jsonb_array_length(r -> 'errors') = 0 and (r ->> 'holding_adjustments')::int >= 3 from r1),
                    'notifier: adjustments ran without errors');

-- Adjustments
create temp table hq as
  select user_id, symbol, quantity, avg_price from public.holdings
  where user_id in ('20202020-0000-4000-8000-00000000000a', '20202020-0000-4000-8000-00000000000b');
select qp_t20.check((select quantity = 20 and avg_price = 1500 from hq where user_id = '20202020-0000-4000-8000-00000000000a' and symbol = 'TCS'),
                    'split: 10 at 3000 became 20 at 1500');
select qp_t20.check((select quantity = 8 and avg_price = 1600 from hq where user_id = '20202020-0000-4000-8000-00000000000b' and symbol = 'TCS'),
                    'split: every holder of the stock is adjusted');
select qp_t20.check((select quantity = 40 and avg_price = 750 from hq where symbol = 'INFY'),
                    'split: a holding edited after the ex-date is left alone');
select qp_t20.check((select quantity = 10 and avg_price = 70 from hq where symbol = 'WIPRO'),
                    'bonus: 7 shares x 1.5 stays whole (10) and keeps the money put in (700)');
select qp_t20.check((select count(*) = 1 from public.notifications
                     where user_id = '20202020-0000-4000-8000-00000000000a' and type = 'holding_adjusted'
                       and data ->> 'symbol' = 'TCS'
                       and body like '%each share became 2 shares. We changed your holding from 10 to 20 shares at an average of ₹1,500.00.%'),
                    'split: the owner is told, in plain numbers');

select private.run_eod_notifier();
select qp_t20.check((select quantity = 20 from public.holdings where user_id = '20202020-0000-4000-8000-00000000000a' and symbol = 'TCS')
                and (select count(*) = 2 from public.holding_adjustments where user_id = '20202020-0000-4000-8000-00000000000a'),
                    'split: a second run changes nothing');

-- Exit messages
select qp_t20.check((select count(*) = 1 from public.notifications n join sig s on s.id::text = n.data ->> 'signal_id'
                     where n.user_id = '20202020-0000-4000-8000-00000000000a' and s.strategy = 'sma_trend'
                       and n.title = 'SMA 20/50 trend closed its trade in TCS'
                       and n.body = 'Its safety stop was hit at ₹3,500.00. This is the rule''s own research trade, not advice. Your holding is unchanged.'),
                    'exit: names the rule, the reason, and that the holding is unchanged');
select qp_t20.check((select count(*) = 0 from public.notifications n join sig s on s.id::text = n.data ->> 'signal_id'
                     where n.user_id = '20202020-0000-4000-8000-00000000000a' and s.strategy = 'kk_dip'),
                    'exit: dip rules are off by default');
select qp_t20.check((select count(*) = 1 from public.notifications n join sig s on s.id::text = n.data ->> 'signal_id'
                     where n.user_id = '20202020-0000-4000-8000-00000000000b' and s.strategy = 'kk_dip'
                       and n.title = 'KK dip closed its trade in TCS' and n.body like 'It sold on the bounce at ₹3,510.00.%')
                and (select count(*) = 0 from public.notifications n join sig s on s.id::text = n.data ->> 'signal_id'
                     where n.user_id = '20202020-0000-4000-8000-00000000000b' and s.strategy = 'sma_trend'),
                    'exit: a person''s own choice of rules is followed');
select qp_t20.check((select bool_and(private.rule_label(k) <> replace(k, '_', ' '))
                     from unnest(array['strong_trend', 'sma_trend', 'ma200_trend', 'rsi_dip', 'kk_dip']) k),
                    'exit: every live rule has a readable name');
select qp_t20.check((select count(*) = 0 from public.audit_log where metadata::text ~ '(TCS|INFY|WIPRO)'),
                    'audit: no symbol written to the audit log');

-- Isolation and grants
select qp_t20.login('20202020-0000-4000-8000-00000000000c');
set local role authenticated;
select qp_t20.check((select count(*) = 0 from public.holding_adjustments), 'isolation: another user sees no adjustments');
select qp_t20.check((select count(*) = 0 from public.notification_prefs), 'isolation: another user sees no rule choices');
select qp_t20.check((select count(*) > 0 from public.corporate_actions), 'corporate actions: readable by any signed in user');
reset role;
create temp table a_tcs as
  select id from public.holding_adjustments where symbol = 'TCS' and user_id = '20202020-0000-4000-8000-00000000000a';
grant select on a_tcs to authenticated;
set local role authenticated;
select qp_t20.expect_error(format('select public.undo_holding_adjustment(%L)', (select id from a_tcs)),
                           'not found', 'isolation: cannot undo another user''s adjustment, even with its id');
select qp_t20.expect_error($$insert into public.notification_prefs (user_id, exit_rules) values ('20202020-0000-4000-8000-00000000000a', '{}')$$,
                           'row-level security', 'isolation: cannot write another user''s rule choices');
select qp_t20.expect_error($$insert into public.notification_prefs (exit_rules) values (array['sma_20_50_cross'])$$,
                           'check constraint', 'prefs: only live rules can be chosen');
select qp_t20.expect_error($$insert into public.corporate_actions (symbol, ex_date, factor) values ('TCS', current_date, 3)$$,
                           'permission denied', 'grants: clients cannot write corporate actions');
select qp_t20.expect_error($$update public.holding_adjustments set undone_at = now()$$,
                           'permission denied', 'grants: clients cannot edit adjustments');
reset role;

-- Undo
select qp_t20.login('20202020-0000-4000-8000-00000000000a');
set local role authenticated;
select public.undo_holding_adjustment((select id from public.holding_adjustments where symbol = 'TCS'));
select qp_t20.check((select quantity = 10 and avg_price = 3000 from public.holdings where symbol = 'TCS'), 'undo: the holding is back as it was');
select qp_t20.check((select undone_at is not null from public.holding_adjustments where symbol = 'TCS'), 'undo: recorded');
select qp_t20.expect_error(format('select public.undo_holding_adjustment(%L)', (select id from public.holding_adjustments where symbol = 'TCS')),
                           'not found', 'undo: only once');
update public.holdings set quantity = 12 where symbol = 'WIPRO';
select qp_t20.expect_error(format('select public.undo_holding_adjustment(%L)', (select id from public.holding_adjustments where symbol = 'WIPRO')),
                           'holding changed', 'undo: an edit made after the adjustment wins');
reset role;
select private.run_eod_notifier();
select qp_t20.check((select quantity = 10 from public.holdings where user_id = '20202020-0000-4000-8000-00000000000a' and symbol = 'TCS'),
                    'undo: the next run does not adjust it again');

do $$ begin raise notice 'HOLDINGS TRUST TESTS PASSED'; end $$;
rollback;
