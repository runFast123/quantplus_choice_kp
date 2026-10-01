-- =====================================================================
-- §9 Isolation test plan, as plain SQL. Everything runs inside one
-- transaction that is ROLLED BACK — safe on staging. Any failure raises
-- an exception naming the test; passes are reported via NOTICE.
--
--   Users: A, B (separate personal tenants, Pro), C (member of org O),
--          D (admin of org O, platform admin), E (Basic trial), F (expired)
-- =====================================================================
begin;

create schema qp_test;
grant usage on schema qp_test to authenticated, service_role, analytics_reader;

create function qp_test.uid(p text) returns uuid language sql immutable as $$
  select (case p
    when 'A' then 'aaaaaaaa-0000-4000-8000-000000000001'
    when 'B' then 'aaaaaaaa-0000-4000-8000-000000000002'
    when 'C' then 'aaaaaaaa-0000-4000-8000-000000000003'
    when 'D' then 'aaaaaaaa-0000-4000-8000-000000000004'
    when 'E' then 'aaaaaaaa-0000-4000-8000-000000000005'
    when 'F' then 'aaaaaaaa-0000-4000-8000-000000000006'
    when 'ORG' then 'eeeeeeee-0000-4000-8000-0000000000aa'
  end)::uuid
$$;

create function qp_test.tenant_of(p text) returns uuid
language sql stable security definer set search_path = '' as $$
  select default_tenant_id from public.profiles where user_id = qp_test.uid(p)
$$;

-- Set JWT claims for a user; tenant defaults to their personal tenant.
create function qp_test.login(p text, p_tenant uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', qp_test.uid(p), 'role', 'authenticated',
    'app_tenant_id', coalesce(p_tenant, qp_test.tenant_of(p)))::text, true);
end $$;

create function qp_test.expect_rows(p_sql text, p_n bigint, p_label text) returns void
language plpgsql as $$
declare v bigint;
begin
  execute format('select count(*) from (%s) q', p_sql) into v;
  if v <> p_n then
    raise exception 'FAIL [%]: expected % rows, got %', p_label, p_n, v;
  end if;
  raise notice 'PASS [%]', p_label;
end $$;

create function qp_test.expect_error(p_sql text, p_pattern text, p_label text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then
      raise notice 'PASS [%] (%)', p_label, sqlerrm;
      return;
    end if;
    raise exception 'FAIL [%]: expected error like "%", got "%"', p_label, p_pattern, sqlerrm;
  end;
  raise exception 'FAIL [%]: expected error like "%", but statement succeeded', p_label, p_pattern;
end $$;

create function qp_test.expect_ok(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS [%]', p_label;
end $$;

grant execute on all functions in schema qp_test to authenticated, service_role, analytics_reader;

-- ---------------------------------------------------------------------
-- Fixtures (as the migration owner)
-- ---------------------------------------------------------------------
insert into auth.users (id, email)
select qp_test.uid(x), lower(x) || '@test.quantspulse.local'
from unnest(array['A','B','C','D','E','F']) x;

-- Signup trigger gave everyone a personal tenant + Basic trial.
select qp_test.expect_rows(
  $$select 1 from public.subscriptions s join public.tenants t on t.id = s.tenant_id
    where s.user_id in (select qp_test.uid(x) from unnest(array['A','B','C','D','E','F']) x)
      and s.plan_code = 'basic' and s.status = 'trialing' and t.type = 'personal'$$,
  6, 'signup: personal tenant + basic trial');

update public.subscriptions set plan_code = 'pro', status = 'active'
 where user_id in (qp_test.uid('A'), qp_test.uid('B'));

insert into public.tenants (id, name, slug, type)
values (qp_test.uid('ORG'), 'Acme Advisory', 'acme-advisory', 'organization');
insert into public.tenant_members (tenant_id, user_id, role) values
  (qp_test.uid('ORG'), qp_test.uid('C'), 'member'),
  (qp_test.uid('ORG'), qp_test.uid('D'), 'admin');
insert into public.subscriptions (tenant_id, user_id, plan_code, status, source, current_period_end)
values (qp_test.uid('ORG'), qp_test.uid('C'), 'pro', 'active', 'manual', now() + interval '1 year');

-- Hook resolves the default (personal) tenant into claims
select qp_test.expect_rows(
  format($$select 1 where public.custom_access_token_hook(
             jsonb_build_object('user_id', %L, 'claims', '{}'::jsonb)) -> 'claims' ->> 'app_tenant_id' = %L$$,
         qp_test.uid('A'), qp_test.tenant_of('A')),
  1, 'hook: app_tenant_id = default tenant');

-- B creates data through RLS (happy path)
select qp_test.login('B');
set local role authenticated;
insert into public.portfolios (id, name) values ('bbbbbbbb-0000-4000-8000-0000000000b1', 'B main');
insert into public.holdings (portfolio_id, symbol, quantity, avg_price)
values ('bbbbbbbb-0000-4000-8000-0000000000b1', 'TCS', 10, 3500);
insert into public.watchlists (id) values ('bbbbbbbb-0000-4000-8000-0000000000b2');
insert into public.watchlist_items (watchlist_id, symbol) values ('bbbbbbbb-0000-4000-8000-0000000000b2', 'INFY');
insert into public.price_alerts (symbol, condition, trigger_price) values ('TCS', 'above', 4000);
select qp_test.expect_rows('select 1 from public.holdings', 1, 'B sees own holding');
reset role;

-- C creates data inside org O
select qp_test.login('C', qp_test.uid('ORG'));
set local role authenticated;
insert into public.portfolios (id) values ('cccccccc-0000-4000-8000-0000000000c1');
insert into public.holdings (portfolio_id, symbol, quantity, avg_price)
values ('cccccccc-0000-4000-8000-0000000000c1', 'HDFCBANK', 5, 1600);
reset role;

-- ---------------------------------------------------------------------
-- Tests 1–4, 9–11: User A
-- ---------------------------------------------------------------------
select qp_test.login('A');
set local role authenticated;

select qp_test.expect_rows(format('select 1 from public.holdings where user_id = %L', qp_test.uid('B')), 0, '1a A reads B holdings');
select qp_test.expect_rows(format('select 1 from public.watchlist_items where user_id = %L', qp_test.uid('B')), 0, '1b A reads B watchlist');
select qp_test.expect_rows(format('select 1 from public.price_alerts where user_id = %L', qp_test.uid('B')), 0, '1c A reads B alerts');

select qp_test.expect_error(format(
  $$insert into public.holdings (portfolio_id, symbol, quantity, avg_price, user_id, tenant_id)
    values ('bbbbbbbb-0000-4000-8000-0000000000b1', 'TCS', 1, 100, %L, %L)$$,
  qp_test.uid('B'), qp_test.tenant_of('B')), 'row-level security', '2 A inserts with B ids');

select qp_test.expect_error(
  $$insert into public.holdings (portfolio_id, symbol, quantity, avg_price)
    values ('bbbbbbbb-0000-4000-8000-0000000000b1', 'TCS', 1, 100)$$,
  'foreign key', '3 A inserts into B portfolio');

select qp_test.login('A', qp_test.tenant_of('B'));
select qp_test.expect_rows('select 1 from public.holdings', 0, '4 A forges app_tenant_id = B');
select qp_test.expect_rows('select 1 from public.portfolios', 0, '4b forged tenant: portfolios');
select qp_test.login('A');

select qp_test.expect_error(format('update public.profiles set default_tenant_id = %L', qp_test.tenant_of('B')),
  'permission denied', '9 A updates default_tenant_id');
select qp_test.expect_ok($$update public.profiles set full_name = 'Asha' where user_id = auth.uid()$$,
  '9b A may update own name');

select qp_test.expect_error('select * from private.broker_credentials', 'permission denied', '10 A reads private.broker_credentials');
select qp_test.expect_error('select * from private.ai_key_secrets', 'permission denied', '10b A reads private.ai_key_secrets');

select qp_test.expect_error(format(
  $$select public.admin_activate_plan(%L, %L, %L, 'pro', 12, 0, 'upi')$$,
  qp_test.uid('A'), qp_test.uid('A'), qp_test.tenant_of('A')),
  'permission denied', '11 authenticated calls admin_activate_plan');

-- App-support RPCs
select qp_test.expect_rows($$select 1 from public.my_entitlements() where plan_code = 'pro' and (features ->> 'alerts')::boolean$$,
  1, 'my_entitlements: A is Pro with alerts');
select qp_test.expect_ok($$select public.track_event('opened_dashboard')$$, 'track_event ok');
select qp_test.expect_error($$select public.track_event('HDFCBANK bought')$$, 'INVALID_EVENT_TYPE', 'track_event rejects free text');
select qp_test.expect_rows($$select 1 where jsonb_array_length(public.export_my_data() -> 'holdings') = 0
                               and public.export_my_data() -> 'profile' ->> 'full_name' = 'Asha'$$,
  1, 'export_my_data: own rows only');
reset role;

-- ---------------------------------------------------------------------
-- Tests 6–8: Admin D in org O; then 5: C removed from O
-- ---------------------------------------------------------------------
select qp_test.login('D', qp_test.uid('ORG'));
set local role authenticated;
select qp_test.expect_rows(format('select 1 from public.holdings where user_id = %L', qp_test.uid('C')), 0, '6 admin D reads C holdings');
select qp_test.expect_rows(format('select 1 from public.tenant_member_directory(%L)', qp_test.uid('ORG')), 2, '7 directory for own org');
select qp_test.expect_rows(format(
  $$select 1 from public.tenant_member_directory(%L) d where d.user_id = %L and d.plan = 'pro'$$,
  qp_test.uid('ORG'), qp_test.uid('C')), 1, '7b directory shows plan, no holdings');
select qp_test.expect_rows(format('select 1 from public.tenant_members where tenant_id = %L', qp_test.uid('ORG')), 2, '7c admin sees org roster');
select qp_test.expect_error(format('select * from public.tenant_member_directory(%L)', qp_test.tenant_of('A')),
  'NOT_AUTHORIZED', '8 directory for another tenant');
reset role;

select qp_test.login('C', qp_test.uid('ORG'));
set local role authenticated;
select qp_test.expect_rows(format('select 1 from public.tenant_members where tenant_id = %L', qp_test.uid('ORG')), 1, 'member C sees only own org membership');
select qp_test.expect_rows('select 1 from public.holdings', 1, '5-pre C sees own org holding');
reset role;
delete from public.tenant_members where tenant_id = qp_test.uid('ORG') and user_id = qp_test.uid('C');
set local role authenticated;   -- same (now stale) JWT
select qp_test.expect_rows('select 1 from public.holdings', 0, '5 removed member, stale JWT');
reset role;

-- ---------------------------------------------------------------------
-- Tests 12–13: Basic user E; 14: expired user F
-- ---------------------------------------------------------------------
select qp_test.login('E');
set local role authenticated;
insert into public.watchlists (id) values ('eeeeeeee-0000-4000-8000-0000000000e1'), ('eeeeeeee-0000-4000-8000-0000000000e2');
insert into public.watchlist_items (watchlist_id, symbol)
select 'eeeeeeee-0000-4000-8000-0000000000e1', s
from unnest(array['TCS','INFY','ITC','SBIN','LT','TITAN','WIPRO','NTPC','ONGC','CIPLA']) s;
select qp_test.expect_error(
  $$insert into public.watchlist_items (watchlist_id, symbol) values ('eeeeeeee-0000-4000-8000-0000000000e1', 'MARUTI')$$,
  'PLAN_LIMIT_REACHED', '12 basic: 11th watchlist symbol');
select qp_test.expect_ok(
  $$insert into public.watchlist_items (watchlist_id, symbol) values ('eeeeeeee-0000-4000-8000-0000000000e2', 'TCS')$$,
  '12b basic: same symbol in 2nd list uses no new slot');
select qp_test.expect_error(
  $$insert into public.price_alerts (symbol, condition, trigger_price) values ('TCS', 'above', 5000)$$,
  'row-level security', '13 basic: price alert gated');
select qp_test.expect_error(
  $$insert into public.portfolios (name) values ('nope')$$,
  'row-level security', '13b basic: portfolio gated');
reset role;

select qp_test.login('F');
set local role authenticated;
insert into public.watchlists (id) values ('ffffffff-0000-4000-8000-0000000000f1');
reset role;
update public.subscriptions set current_period_end = now() - interval '1 day' where user_id = qp_test.uid('F');
set local role authenticated;
select qp_test.expect_error(
  $$insert into public.watchlist_items (watchlist_id, symbol) values ('ffffffff-0000-4000-8000-0000000000f1', 'TCS')$$,
  'NO_ACTIVE_PLAN', '14 expired: insert watchlist item');
select qp_test.expect_rows($$select 1 from public.my_entitlements() where features = '{}'::jsonb$$, 1, '14b expired: no features');
reset role;

-- ---------------------------------------------------------------------
-- admin_activate_plan (service role) — and 17 audit immutability
-- ---------------------------------------------------------------------
-- D becomes a platform admin only now, so tests 6–8 exercise a plain tenant admin.
insert into private.platform_admins (user_id, note) values (qp_test.uid('D'), 'test');
set local role service_role;
select qp_test.expect_error(format(
  $$select public.admin_activate_plan(%L, %L, %L, 'pro', 12, 1000000, 'upi', 'UTR1')$$,
  qp_test.uid('A'), qp_test.uid('E'), qp_test.tenant_of('E')),
  'NOT_AUTHORIZED', 'activate_plan: non-admin actor');
select qp_test.expect_rows(format(
  $$select 1 from public.admin_activate_plan(%L, %L, %L, 'pro', 12, 1000000, 'upi', 'UTR1') s
    where s.plan_code = 'pro' and s.status = 'active'$$,
  qp_test.uid('D'), qp_test.uid('E'), qp_test.tenant_of('E')),
  1, 'activate_plan: trial -> pro');
reset role;
select qp_test.expect_rows(format($$select 1 from public.payments where user_id = %L and amount_paise = 1000000$$, qp_test.uid('E')),
  1, 'activate_plan: payment recorded');

select qp_test.login('E');
set local role authenticated;
select qp_test.expect_ok($$insert into public.price_alerts (symbol, condition, trigger_price) values ('TCS', 'above', 5000)$$,
  'activate_plan: alerts unlocked for E');
select qp_test.expect_rows('select 1 from public.audit_log', 1, '17b owner reads own tenant audit');
reset role;

select qp_test.expect_error('update public.audit_log set action = action', 'append-only', '17 update audit_log');
select qp_test.expect_error('delete from public.audit_log', 'append-only', '17c delete audit_log');

-- ---------------------------------------------------------------------
-- 15: analytics_reader; 16: storage
-- ---------------------------------------------------------------------
-- PG16+: creating a role doesn't let you SET ROLE to it; grant inside this rolled-back tx.
grant analytics_reader to current_user;
set local role analytics_reader;
select qp_test.expect_error('select * from public.holdings', 'permission denied', '15 analytics_reader reads holdings');
select qp_test.expect_ok('select * from public.market_symbols', '15b analytics_reader reads market data');
reset role;

insert into storage.objects (bucket_id, name)
values ('contract-notes', qp_test.uid('B')::text || '/note.pdf');
select qp_test.login('A');
set local role authenticated;
select qp_test.expect_rows('select 1 from storage.objects', 0, '16 A reads B storage object');
select qp_test.expect_error(format($$insert into storage.objects (bucket_id, name) values ('contract-notes', %L)$$,
  qp_test.uid('B')::text || '/x.pdf'), 'row-level security', '16b A writes into B folder');
reset role;

-- ---------------------------------------------------------------------
-- Service-role RPC bridge to the private schema
-- ---------------------------------------------------------------------
select qp_test.login('B');
set local role authenticated;
select qp_test.expect_error(format('select public.svc_is_platform_admin(%L)', qp_test.uid('B')),
  'permission denied', 'svc: authenticated cannot probe admins');
select qp_test.expect_error(
  $$select * from public.svc_get_ai_key_secret('00000000-0000-0000-0000-000000000000')$$,
  'permission denied', 'svc: authenticated cannot read secrets');
select qp_test.expect_error($$select * from public.svc_admin_user_search('')$$,
  'permission denied', 'svc: authenticated cannot search users');
reset role;

insert into public.ai_provider_keys (id, tenant_id, user_id, provider, key_last4)
values ('dddddddd-0000-4000-8000-0000000000d1', qp_test.tenant_of('B'), qp_test.uid('B'), 'openai', 'abcd');
set local role service_role;
select public.svc_put_ai_key_secret('dddddddd-0000-4000-8000-0000000000d1', 'Y2lwaGVy', 'aXY=', 'dGFn', 1::smallint);
select qp_test.expect_rows(
  $$select 1 from public.svc_get_ai_key_secret('dddddddd-0000-4000-8000-0000000000d1') where ciphertext = 'Y2lwaGVy'$$,
  1, 'svc: secret round-trip');
select qp_test.expect_rows(format('select 1 where public.svc_is_platform_admin(%L)', qp_test.uid('D')), 1, 'svc: D is platform admin');
select qp_test.expect_rows($$select 1 from public.svc_admin_user_search('b@test') where email = 'b@test.quantspulse.local'$$,
  1, 'svc: admin user search');
reset role;

select qp_test.login('B');
set local role authenticated;
select qp_test.expect_rows('select key_last4 from public.ai_provider_keys', 1, 'BYOK: owner sees last4 only');
delete from public.ai_provider_keys where id = 'dddddddd-0000-4000-8000-0000000000d1';
reset role;
select qp_test.expect_rows($$select 1 from private.ai_key_secrets where key_id = 'dddddddd-0000-4000-8000-0000000000d1'$$,
  0, 'BYOK: deleting key cascades secret');

-- ---------------------------------------------------------------------
-- 18: §5.14 verification queries
-- ---------------------------------------------------------------------
select qp_test.expect_rows($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity$$,
  0, '18a every public table has RLS');
select qp_test.expect_rows($$
  select table_name from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public' and table_name <> 'plans'$$,
  0, '18b anon has no grants except plans');

-- Deleting a user removes their personal workspace but not organisations they belong to.
select qp_test.expect_rows(format('select 1 from public.tenants where id = %L', qp_test.tenant_of('F')), 1, 'cleanup-pre: F personal tenant exists');
create temp table _f_tenant as select qp_test.tenant_of('F') as id;
delete from auth.users where id = qp_test.uid('F');
select qp_test.expect_rows('select 1 from public.tenants where id = (select id from _f_tenant)', 0, 'cleanup: deleting a user deletes their personal tenant');
select qp_test.expect_rows(format('select 1 from public.tenants where id = %L', qp_test.uid('ORG')), 1, 'cleanup: organisation tenants survive member deletion');

do $$ begin raise notice 'ALL ISOLATION TESTS PASSED'; end $$;
rollback;
