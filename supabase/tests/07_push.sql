-- Browser push (migration 30): subscriptions are private to their owner, and the sender's
-- claim function hands each notification out once. Rolled back.
begin;

create schema qp_t7;
create function qp_t7.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t7.expect_error(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then raise notice 'PASS [%]', p_label; return; end if;
    raise exception 'FAIL [%]: got "%"', p_label, sqlerrm;
  end;
  raise exception 'FAIL [%]: no error', p_label;
end $$;
create function qp_t7.login(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
    'app_tenant_id', (select default_tenant_id from public.profiles where user_id = p_user))::text, true);
end $$;
grant usage on schema qp_t7 to authenticated, service_role;
grant execute on all functions in schema qp_t7 to authenticated, service_role;

insert into auth.users (id, email) values
  ('77777777-0000-4000-8000-000000000001', 'a@t7.test'),
  ('77777777-0000-4000-8000-000000000002', 'b@t7.test');

-- A subscribes this browser.
select qp_t7.login('77777777-0000-4000-8000-000000000001');
set local role authenticated;
insert into public.push_subscriptions (endpoint, p256dh, auth)
values ('https://push.example.test/a1', repeat('p', 87), repeat('a', 22));
select qp_t7.check((select count(*) = 1 from public.push_subscriptions), 'own: A sees their browser');
select qp_t7.check((select user_id = '77777777-0000-4000-8000-000000000001' from public.push_subscriptions), 'own: user defaults to caller');
select qp_t7.expect_error($$insert into public.push_subscriptions (endpoint, p256dh, auth)
  values ('http://insecure.test/x', repeat('p', 87), repeat('a', 22))$$, 'check constraint', 'shape: https endpoints only');
select qp_t7.expect_error($$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values ('77777777-0000-4000-8000-000000000002', 'https://push.example.test/forged', repeat('p', 87), repeat('a', 22))$$,
  'row-level security', 'isolation: cannot subscribe someone else');
select qp_t7.expect_error($$update public.push_subscriptions set endpoint = 'https://push.example.test/moved'$$,
  'permission denied', 'shape: rows are not editable');
reset role;

-- B can't see or remove A's browser.
select qp_t7.login('77777777-0000-4000-8000-000000000002');
set local role authenticated;
select qp_t7.check((select count(*) = 0 from public.push_subscriptions), 'isolation: B sees nothing of A');
delete from public.push_subscriptions;
reset role;
select qp_t7.check((select count(*) = 1 from public.push_subscriptions where user_id = '77777777-0000-4000-8000-000000000001'),
                   'isolation: B cannot delete A''s browser');

-- The claim function: service role only, each notification once, old ones skipped.
insert into public.notifications (tenant_id, user_id, type, title)
select default_tenant_id, user_id, 'price_alert', 'QP t7 fresh' from public.profiles where user_id = '77777777-0000-4000-8000-000000000001';
insert into public.notifications (tenant_id, user_id, type, title, created_at)
select default_tenant_id, user_id, 'price_alert', 'QP t7 stale', now() - interval '3 days' from public.profiles where user_id = '77777777-0000-4000-8000-000000000001';

select qp_t7.login('77777777-0000-4000-8000-000000000001');
set local role authenticated;
select qp_t7.expect_error($$select * from public.svc_claim_push_batch(10)$$, 'permission denied', 'svc: users cannot claim');
reset role;

set local role service_role;
create temp table qp_t7_first as select * from public.svc_claim_push_batch(1000);
select qp_t7.check((select count(*) = 1 from qp_t7_first where title like 'QP t7%'), 'claim: fresh notification handed out');
select qp_t7.check((select count(*) = 0 from qp_t7_first where title = 'QP t7 stale'), 'claim: older than two days skipped');
select qp_t7.check((select count(*) = 0 from public.svc_claim_push_batch(1000) where title like 'QP t7%'), 'claim: never handed out twice');
reset role;

-- Export includes the subscription (endpoint and when), never the keys.
select qp_t7.login('77777777-0000-4000-8000-000000000001');
set local role authenticated;
select qp_t7.check((select jsonb_array_length(public.export_my_data() -> 'push_subscriptions') = 1), 'export: browsers listed');
select qp_t7.check((select not (public.export_my_data() -> 'push_subscriptions' -> 0 ? 'p256dh')), 'export: keys left out');
reset role;

rollback;
