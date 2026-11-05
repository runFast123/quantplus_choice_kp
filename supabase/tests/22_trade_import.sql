-- Tradebook import (migration 53): the dry run stores nothing and reports each stock; the import is all or nothing,
-- skips what is already stored, replaces chosen opening balances and keeps them; undo puts them back; isolation.
-- Rolled back.
begin;

create schema qp_t22;
create function qp_t22.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t22.expect_error(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then raise notice 'PASS [%]', p_label; return; end if;
    raise exception 'FAIL [%]: got "%"', p_label, sqlerrm;
  end;
  raise exception 'FAIL [%]: no error', p_label;
end $$;
create function qp_t22.login(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
    'app_tenant_id', (select default_tenant_id from public.profiles where user_id = p_user))::text, true);
end $$;
create function qp_t22.pos(p_symbol text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select trim_scale(quantity)::text || '@' || trim_scale(round(avg_price, 2))::text from public.holdings
                   where user_id = '22222222-0000-4000-8000-00000000000a' and symbol = p_symbol), 'none')
$$;
create function qp_t22.trades() returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.portfolio_transactions where user_id = '22222222-0000-4000-8000-00000000000a'
$$;
grant usage on schema qp_t22 to authenticated;
grant execute on all functions in schema qp_t22 to authenticated;

-- P: Pro, imports.  M: Pro, someone else.  B: Basic.
insert into auth.users (id, email) values
  ('22222222-0000-4000-8000-00000000000a', 'p@t22.test'),
  ('22222222-0000-4000-8000-00000000000b', 'm@t22.test'),
  ('22222222-0000-4000-8000-00000000000c', 'b@t22.test');
update public.subscriptions set plan_code = 'pro', status = 'active'
 where user_id in ('22222222-0000-4000-8000-00000000000a', '22222222-0000-4000-8000-00000000000b');
insert into public.portfolios (id, tenant_id, user_id)
select ('22222222-0000-4000-8000-0000000001' || right(user_id::text, 2))::uuid, default_tenant_id, user_id
from public.profiles where user_id::text like '22222222-%';
-- P entered TCS by hand: 10 at 3,000 as of 1 Oct 2026.
insert into public.portfolio_transactions (tenant_id, user_id, portfolio_id, symbol, kind, trade_date, quantity, price, source)
select default_tenant_id, user_id, '22222222-0000-4000-8000-00000000010a', 'TCS', 'opening', '2026-10-01', 10, 3000, 'opening'
from public.profiles where user_id = '22222222-0000-4000-8000-00000000000a';

create temp table rows_all as select $j$[
  {"symbol":"TCS",  "kind":"buy",  "trade_date":"2026-01-05", "quantity":10, "price":2900, "broker_ref":"t:NSE:1"},
  {"symbol":"INFY", "kind":"buy",  "trade_date":"2026-02-01", "quantity":5,  "price":1500, "broker_ref":"t:NSE:2"},
  {"symbol":"INFY", "kind":"sell", "trade_date":"2026-03-01", "quantity":10, "price":1600, "broker_ref":"t:NSE:3"},
  {"symbol":"WIPRO","kind":"buy",  "trade_date":"2026-04-01", "quantity":3,  "price":500,  "broker_ref":"t:NSE:4"}
]$j$::jsonb as j;
create temp table rows_ok as select $j$[
  {"symbol":"TCS",  "kind":"buy", "trade_date":"2026-01-05", "quantity":10, "price":2900, "broker_ref":"t:NSE:1"},
  {"symbol":"WIPRO","kind":"buy", "trade_date":"2026-04-01", "quantity":3,  "price":500,  "broker_ref":"t:NSE:4"}
]$j$::jsonb as j;
grant select on rows_all, rows_ok to authenticated;

select qp_t22.login('22222222-0000-4000-8000-00000000000a');
set local role authenticated;

-- ------------------------------------------------------------------ dry run
create temp table pv as select public.preview_trades('22222222-0000-4000-8000-00000000010a', (select j from rows_all)) as r;
select qp_t22.check((select count(*) = 3 from pv, jsonb_array_elements(r)), 'preview: one answer per stock');
select qp_t22.check((select e ->> 'ok' = 'false' and e ->> 'error' like 'SELL_EXCEEDS_HOLDING: INFY sold 10%'
                     from pv, jsonb_array_elements(r) e where e ->> 'symbol' = 'INFY'),
                    'preview: a sale of shares bought before the file starts is named, per stock');
select qp_t22.check((select (e -> 'after' ->> 'quantity')::numeric = 20 and (e -> 'before' ->> 'quantity')::numeric = 10
                       and (e -> 'before' ->> 'opening_only')::boolean
                     from pv, jsonb_array_elements(r) e where e ->> 'symbol' = 'TCS'),
                    'preview: kept beside the opening balance, TCS would be 20 (it was 10, entered by hand)');
select qp_t22.check((select (e -> 'after' ->> 'quantity')::numeric = 3 and (e ->> 'added')::int = 1
                     from pv, jsonb_array_elements(r) e where e ->> 'symbol' = 'WIPRO'),
                    'preview: other stocks are still worked out');
select qp_t22.check(qp_t22.trades() = 1 and qp_t22.pos('TCS') = '10@3000' and qp_t22.pos('WIPRO') = 'none',
                    'preview: nothing is stored');
create temp table pv2 as select public.preview_trades('22222222-0000-4000-8000-00000000010a', (select j from rows_ok), array['TCS']) as r;
select qp_t22.check((select (e -> 'after' ->> 'quantity')::numeric = 10 and (e -> 'after' ->> 'avg_price')::numeric = 2900
                     from pv2, jsonb_array_elements(r) e where e ->> 'symbol' = 'TCS'),
                    'preview: with the tradebook in place of the opening balance, TCS is 10 at 2,900');

-- ------------------------------------------------------------------ import
select qp_t22.expect_error($$select public.import_trades('22222222-0000-4000-8000-00000000010a', 'zerodha', (select j from rows_all))$$,
                           'SELL_EXCEEDS_HOLDING', 'import: refused while a stock does not add up');
select qp_t22.check(qp_t22.trades() = 1 and (select count(*) = 0 from public.portfolio_imports),
                    'import: a refused import leaves nothing behind');
create temp table im as select public.import_trades('22222222-0000-4000-8000-00000000010a', 'zerodha', (select j from rows_ok), array['TCS'], 1) as r;
select qp_t22.check((select (r ->> 'added')::int = 2 and (r ->> 'duplicates')::int = 0 and (r ->> 'replaced')::int = 1 from im),
                    'import: 2 trades added, 1 opening balance replaced');
select qp_t22.check(qp_t22.pos('TCS') = '10@2900' and qp_t22.pos('WIPRO') = '3@500', 'import: the holdings follow the tradebook');
select qp_t22.check((select broker = 'zerodha' and trades_added = 2 and skipped = 1 and date_from = '2026-01-05' and date_to = '2026-04-01'
                       and jsonb_array_length(replaced_openings) = 1 from public.portfolio_imports),
                    'import: recorded with its counts, dates and the opening balance it replaced');
create temp table im2 as select public.import_trades('22222222-0000-4000-8000-00000000010a', 'zerodha', (select j from rows_ok)) as r;
select qp_t22.check((select (r ->> 'added')::int = 0 and (r ->> 'duplicates')::int = 2 and r -> 'import_id' = 'null'::jsonb from im2)
                and (select count(*) = 1 from public.portfolio_imports),
                    'import: the same file again adds nothing and leaves no empty import');

-- ------------------------------------------------------------------ undo
select public.undo_import((select (r ->> 'import_id')::uuid from im));
select qp_t22.check(qp_t22.pos('TCS') = '10@3000' and qp_t22.pos('WIPRO') = 'none' and qp_t22.trades() = 1
                and (select count(*) = 0 from public.portfolio_imports),
                    'undo: the opening balance is back and the imported trades are gone');
create temp table im3 as select public.import_trades('22222222-0000-4000-8000-00000000010a', 'zerodha',
  $j$[{"symbol":"WIPRO","kind":"buy","trade_date":"2026-04-01","quantity":3,"price":500,"broker_ref":"t:NSE:4"}]$j$::jsonb) as r;
insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price)
values ('22222222-0000-4000-8000-00000000010a', 'WIPRO', 'sell', '2026-05-01', 3, 550);
select qp_t22.expect_error(format('select public.undo_import(%L)', (select r ->> 'import_id' from im3)),
                           'SELL_EXCEEDS_HOLDING', 'undo: refused while a later sale needs the imported shares');
select qp_t22.check((select count(*) = 1 from public.portfolio_imports), 'undo: a refused undo changes nothing');
select qp_t22.expect_error($$select public.preview_trades('22222222-0000-4000-8000-00000000010a',
                             '[{"symbol":"TCS","kind":"opening","trade_date":"2026-01-05","quantity":1,"price":1}]')$$,
                           'INVALID_INPUT', 'rows: only buys and sells come from a tradebook');
reset role;

-- ------------------------------------------------------------------ who may
select qp_t22.login('22222222-0000-4000-8000-00000000000b');
set local role authenticated;
select qp_t22.expect_error($$select public.preview_trades('22222222-0000-4000-8000-00000000010a', (select j from rows_ok))$$,
                           'NOT_AUTHORIZED', 'isolation: cannot preview into someone else''s portfolio');
select qp_t22.expect_error($$select public.import_trades('22222222-0000-4000-8000-00000000010a', 'zerodha', (select j from rows_ok))$$,
                           'NOT_AUTHORIZED', 'isolation: cannot import into someone else''s portfolio');
select qp_t22.expect_error(format('select public.undo_import(%L)', (select r ->> 'import_id' from im3)),
                           'not found', 'isolation: cannot undo someone else''s import');
reset role;
select qp_t22.login('22222222-0000-4000-8000-00000000000c');
set local role authenticated;
select qp_t22.expect_error($$select public.import_trades('22222222-0000-4000-8000-00000000010c', 'zerodha', (select j from rows_ok))$$,
                           'NOT_AUTHORIZED', 'plan: Basic cannot import');
reset role;
select qp_t22.check(qp_t22.pos('WIPRO') = 'none' and (select count(*) = 1 from public.portfolio_imports
                                                       where user_id = '22222222-0000-4000-8000-00000000000a'),
                    'isolation: nothing changed for the owner');

do $$ begin raise notice 'TRADE IMPORT TESTS PASSED'; end $$;
rollback;
