-- The portfolio ledger (migration 51): opening balances, oldest-first lots, realized gains with charges, refused
-- oversells, intraday, splits by date in any order, undo, imports and their undo, duplicates, plan gate, isolation.
-- Rolled back.
begin;

create schema qp_t21;
create function qp_t21.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t21.expect_error(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then raise notice 'PASS [%]', p_label; return; end if;
    raise exception 'FAIL [%]: got "%"', p_label, sqlerrm;
  end;
  raise exception 'FAIL [%]: no error', p_label;
end $$;
create function qp_t21.login(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
    'app_tenant_id', (select default_tenant_id from public.profiles where user_id = p_user))::text, true);
end $$;
-- one position's holding, as "qty@avg" ('none' when there is no holding)
create function qp_t21.pos(p_user uuid, p_symbol text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select trim_scale(quantity)::text || '@' || trim_scale(round(avg_price, 2))::text
                   from public.holdings where user_id = p_user and symbol = p_symbol), 'none')
$$;
grant usage on schema qp_t21 to authenticated;
grant execute on all functions in schema qp_t21 to authenticated;

-- L: Pro, holds things.  M: Pro, someone else.  B: Basic trial (no portfolio feature).
insert into auth.users (id, email) values
  ('21212121-0000-4000-8000-00000000000a', 'l@t21.test'),
  ('21212121-0000-4000-8000-00000000000b', 'm@t21.test'),
  ('21212121-0000-4000-8000-00000000000c', 'b@t21.test');
update public.subscriptions set plan_code = 'pro', status = 'active'
 where user_id in ('21212121-0000-4000-8000-00000000000a', '21212121-0000-4000-8000-00000000000b');
insert into public.portfolios (id, tenant_id, user_id)
select ('21212121-0000-4000-8000-0000000001' || right(user_id::text, 2))::uuid, default_tenant_id, user_id
from public.profiles where user_id in ('21212121-0000-4000-8000-00000000000a', '21212121-0000-4000-8000-00000000000b',
                                       '21212121-0000-4000-8000-00000000000c');

-- ------------------------------------------------------------------ opening balances
insert into public.holdings (tenant_id, user_id, portfolio_id, symbol, quantity, avg_price, created_at, updated_at)
select default_tenant_id, user_id, '21212121-0000-4000-8000-00000000010a', 'HDFCBANK', 25, 1600,
       timestamptz '2026-10-10 10:00+05:30', timestamptz '2026-10-10 10:00+05:30'
from public.profiles where user_id = '21212121-0000-4000-8000-00000000000a';
create temp table h0 as select id, quantity, avg_price from public.holdings where symbol = 'HDFCBANK'
  and user_id = '21212121-0000-4000-8000-00000000000a';
select private.ensure_opening_balances();
select qp_t21.check((select count(*) = 1 from public.portfolio_transactions
                     where user_id = '21212121-0000-4000-8000-00000000000a' and symbol = 'HDFCBANK'
                       and kind = 'opening' and trade_date = date '2026-10-10' and quantity = 25 and price = 1600),
                    'opening: an existing holding becomes one opening balance, dated the day it was last edited');
select qp_t21.check((select h.id = h0.id and h.quantity = h0.quantity and h.avg_price = h0.avg_price
                     from public.holdings h, h0 where h.id = h0.id),
                    'opening: the holding keeps its id and its numbers');
select qp_t21.check(private.ensure_opening_balances() = 0, 'opening: a second run adds nothing');

-- ------------------------------------------------------------------ trades, as the owner
select qp_t21.login('21212121-0000-4000-8000-00000000000a');
set local role authenticated;

-- Oldest first, with charges: 10 @ 100 (+₹10), 10 @ 200, then sell 15 @ 300 (−₹15).
insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price, charges) values
  ('21212121-0000-4000-8000-00000000010a', 'INFY', 'buy',  '2026-01-05', 10, 100, 10),
  ('21212121-0000-4000-8000-00000000010a', 'INFY', 'buy',  '2026-02-05', 10, 200, 0);
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000a', 'INFY') = '20@150',
                    'buys: 10 at 100 and 10 at 200 make 20 at an average of 150 (charges not in the average)');
insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price, charges) values
  ('21212121-0000-4000-8000-00000000010a', 'INFY', 'sell', '2026-03-05', 15, 300, 15);
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000a', 'INFY') = '5@200',
                    'sell: the oldest shares go first, the 5 left cost 200');
select qp_t21.check((select array_agg(trim_scale(quantity)::text || ':' || trim_scale(cost)::text || ':' || trim_scale(proceeds)::text
                                      || ':' || trim_scale(gain)::text || ':' || days_held order by buy_date)
                     from public.portfolio_realized where symbol = 'INFY')
                    = array['10:1010:2990:1980:59', '5:1000:1495:495:28'],
                    'realized: each lot''s gain after both charges (10 → ₹1,980; 5 → ₹495), with days held');

-- Refused oversell, nothing saved.
select qp_t21.expect_error($$insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price)
                             values ('21212121-0000-4000-8000-00000000010a', 'INFY', 'sell', '2026-04-01', 6, 310)$$,
                           'SELL_EXCEEDS_HOLDING', 'sell: more than you hold is refused');
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000a', 'INFY') = '5@200'
                and (select count(*) = 3 from public.portfolio_transactions where symbol = 'INFY'),
                    'sell: a refused sell leaves nothing behind');
select qp_t21.expect_error($$insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price)
                             values ('21212121-0000-4000-8000-00000000010a', 'INFY', 'buy', current_date + 5, 1, 1)$$,
                           'TRADE_IN_FUTURE', 'dates: a trade after today is refused');

-- Intraday: sold 5 then bought them back the same day, one statement, sell listed first.
insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price) values
  ('21212121-0000-4000-8000-00000000010a', 'WIPRO', 'sell', '2026-04-10', 5, 110),
  ('21212121-0000-4000-8000-00000000010a', 'WIPRO', 'buy',  '2026-04-10', 5, 100);
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000a', 'WIPRO') = 'none'
                and (select gain = 50 and days_held = 0 from public.portfolio_realized where symbol = 'WIPRO'),
                    'intraday: a same-day sell and buy-back is one lot, ₹50 made, nothing held');

-- Editing a past buy, then deleting the last trades.
update public.portfolio_transactions set price = 150 where symbol = 'INFY' and trade_date = '2026-02-05';
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000a', 'INFY') = '5@150',
                    'edit: changing a past buy works the holding out again');
delete from public.portfolio_transactions where symbol = 'WIPRO';
select qp_t21.check((select count(*) = 0 from public.portfolio_realized where symbol = 'WIPRO')
                and (select count(*) = 0 from public.portfolio_lots where symbol = 'WIPRO'),
                    'delete: removing a stock''s trades removes its lots and gains');
select qp_t21.expect_error($$update public.portfolio_transactions set symbol = 'TCS' where symbol = 'INFY'$$,
                           'permission denied', 'edit: a trade''s stock cannot be changed');
select qp_t21.expect_error($$update public.portfolio_transactions set kind = 'buy' where kind = 'sell'$$,
                           'permission denied', 'edit: a trade''s side cannot be changed');
reset role;

-- ------------------------------------------------------------------ splits by date, in any order
-- RELIANCE split 1:2 on 1 Jun 2026: bought 10 @ 3,000 before it and 4 @ 1,600 after it.
insert into public.corporate_actions (symbol, exchange, ex_date, factor) values ('RELIANCE', 'NSE', '2026-06-01', 2);
select qp_t21.login('21212121-0000-4000-8000-00000000000a');
set local role authenticated;
insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price) values
  ('21212121-0000-4000-8000-00000000010a', 'RELIANCE', 'buy', '2026-06-10', 4, 1600),
  ('21212121-0000-4000-8000-00000000010a', 'RELIANCE', 'buy', '2026-05-01', 10, 3000);
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000a', 'RELIANCE') = '24@1516.67',
                    'split: only shares bought before the ex-date double (10 → 20 at 1,500, plus 4 at 1,600)');
select qp_t21.check((select buy_quantity = 10 and buy_price = 3000 and open_quantity = 20 and open_price = 1500
                     from public.portfolio_lots where symbol = 'RELIANCE' and buy_date = '2026-05-01'),
                    'split: the lot keeps what was bought and shows today''s shares');
-- A tradebook spanning two splits imports in one go: ITC bought 10, split, sold 15, split again.
reset role;
insert into public.corporate_actions (symbol, exchange, ex_date, factor) values
  ('ITC', 'NSE', '2026-02-01', 2), ('ITC', 'NSE', '2026-04-01', 2);
select qp_t21.login('21212121-0000-4000-8000-00000000000a');
set local role authenticated;
insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price) values
  ('21212121-0000-4000-8000-00000000010a', 'ITC', 'sell', '2026-03-01', 15, 300),
  ('21212121-0000-4000-8000-00000000010a', 'ITC', 'buy',  '2026-01-10', 10, 400);
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000a', 'ITC') = '10@100',
                    'split: 10 at 400 → 20 at 200, sell 15 → 5, → 10 at 100, entered in any order');
reset role;
select qp_t21.check(private.held_before('21212121-0000-4000-8000-00000000010a', '21212121-0000-4000-8000-00000000000a',
                      (select default_tenant_id from public.profiles where user_id = '21212121-0000-4000-8000-00000000000a'),
                      'ITC', 'NSE', '2026-04-01') = 5, 'split: held the day before the second split = 5');
-- These splits are months old and the trades were entered today: applied quietly, never announced.
select private.apply_corporate_actions();
select qp_t21.check((select count(*) = 0 from public.notifications
                     where user_id = '21212121-0000-4000-8000-00000000000a' and type = 'holding_adjusted'),
                    'split: an old split behind imported trades is not announced');
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000a', 'RELIANCE') = '24@1516.67',
                    'split: the evening job does not apply it twice');

-- A recent split on a holding entered before it is announced and can be undone.
insert into public.corporate_actions (symbol, exchange, ex_date, factor)
values ('HDFCBANK', 'NSE', (now() at time zone 'Asia/Kolkata')::date - 1, 2);
select private.apply_corporate_actions();
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000a', 'HDFCBANK') = '50@800',
                    'split: a recent split doubles the opening balance (25 at 1,600 → 50 at 800)');
select qp_t21.check((select count(*) = 1 from public.holding_adjustments a join public.notifications n
                       on n.data ->> 'adjustment_id' = a.id::text
                     where a.user_id = '21212121-0000-4000-8000-00000000000a' and a.symbol = 'HDFCBANK'
                       and a.old_quantity = 25 and a.new_quantity = 50),
                    'split: announced once, with the numbers before and after');
select qp_t21.login('21212121-0000-4000-8000-00000000000a');
set local role authenticated;
insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price)
values ('21212121-0000-4000-8000-00000000010a', 'HDFCBANK', 'sell', (now() at time zone 'Asia/Kolkata')::date, 30, 820);
select qp_t21.expect_error(format('select public.undo_holding_adjustment(%L)', (select id from public.holding_adjustments where symbol = 'HDFCBANK')),
                           'SELL_EXCEEDS_HOLDING', 'undo: refused while a later sell needs the split''s shares');
delete from public.portfolio_transactions where symbol = 'HDFCBANK' and kind = 'sell';
select public.undo_holding_adjustment((select id from public.holding_adjustments where symbol = 'HDFCBANK'));
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000a', 'HDFCBANK') = '25@1600',
                    'undo: back to 25 at 1,600');
-- A new buy after the undo keeps the split out.
insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price)
values ('21212121-0000-4000-8000-00000000010a', 'HDFCBANK', 'buy', (now() at time zone 'Asia/Kolkata')::date, 5, 1600);
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000a', 'HDFCBANK') = '30@1600',
                    'undo: stays undone when the stock is traded again');
reset role;
select private.apply_corporate_actions();
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000a', 'HDFCBANK') = '30@1600',
                    'undo: the evening job does not bring it back');

-- ------------------------------------------------------------------ imports
select qp_t21.login('21212121-0000-4000-8000-00000000000a');
set local role authenticated;
create temp table imp (id uuid);
with i as (insert into public.portfolio_imports (portfolio_id, broker, trades_added)
           values ('21212121-0000-4000-8000-00000000010a', 'zerodha', 2) returning id)
insert into imp select id from i;
insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price, source, broker_ref, import_id)
select '21212121-0000-4000-8000-00000000010a', 'TCS', 'buy', d, 2, 3000, 'tradebook', ref, (select id from imp)
from (values (date '2026-07-01', 'T1'), (date '2026-07-02', 'T2')) v(d, ref);
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000a', 'TCS') = '4@3000'
                and (select source = 'import' from public.holdings where symbol = 'TCS'
                       and user_id = '21212121-0000-4000-8000-00000000000a'),
                    'import: trades make the holding, marked as imported');
select qp_t21.expect_error($$insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price, source, broker_ref)
                             values ('21212121-0000-4000-8000-00000000010a', 'TCS', 'buy', '2026-07-01', 2, 3000, 'tradebook', 'T1')$$,
                           'duplicate key', 'import: the same broker trade is never stored twice');
delete from public.portfolio_imports where id = (select id from imp);
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000a', 'TCS') = 'none'
                and (select count(*) = 0 from public.portfolio_transactions where symbol = 'TCS'),
                    'import: undoing an import removes exactly its trades');
reset role;

-- ------------------------------------------------------------------ plan gate, isolation, grants
select qp_t21.login('21212121-0000-4000-8000-00000000000c');
set local role authenticated;
select qp_t21.expect_error($$insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price)
                             values ('21212121-0000-4000-8000-00000000010c', 'TCS', 'buy', '2026-07-01', 1, 3000)$$,
                           'row-level security', 'plan: Basic cannot record trades');
reset role;

select qp_t21.login('21212121-0000-4000-8000-00000000000b');
set local role authenticated;
select qp_t21.check((select count(*) = 0 from public.portfolio_transactions)
                and (select count(*) = 0 from public.portfolio_lots)
                and (select count(*) = 0 from public.portfolio_realized)
                and (select count(*) = 0 from public.portfolio_imports),
                    'isolation: another user sees none of the trades, lots, gains or imports');
select qp_t21.expect_error($$insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price)
                             values ('21212121-0000-4000-8000-00000000010a', 'TCS', 'buy', '2026-07-01', 1, 3000)$$,
                           'violates', 'isolation: cannot record a trade in someone else''s portfolio');
select qp_t21.check((select count(*) = 0 from public.portfolio_transactions), 'isolation: still nothing visible');
delete from public.portfolio_transactions;
select qp_t21.expect_error($$insert into public.portfolio_lots (buy_txn_id, tenant_id, user_id, portfolio_id, symbol, exchange,
                             buy_date, kind, buy_quantity, buy_price, open_quantity, open_price, charges)
                             values (gen_random_uuid(), private.active_tenant_id(), auth.uid(), '21212121-0000-4000-8000-00000000010b',
                                     'TCS', 'NSE', '2026-07-01', 'buy', 1, 1, 1, 1, 0)$$,
                           'permission denied', 'grants: lots are written by the ledger only');
select qp_t21.expect_error($$delete from public.portfolio_realized$$, 'permission denied', 'grants: gains are written by the ledger only');
select qp_t21.check((select jsonb_typeof(public.export_my_data() -> 'portfolio_transactions') = 'array'),
                    'data rights: the export includes the trades');

-- Pro holds up to 15 stocks: 15 in one statement work, a 16th is refused, more of a held one is fine.
insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price)
select '21212121-0000-4000-8000-00000000010b', 'S' || g, 'buy', '2026-07-01', 1, 100 from generate_series(1, 15) g;
select qp_t21.expect_error($$insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price)
                             values ('21212121-0000-4000-8000-00000000010b', 'S16', 'buy', '2026-07-01', 1, 100)$$,
                           'PLAN_LIMIT_REACHED', 'plan: the 16th stock is refused, as before the ledger');
insert into public.portfolio_transactions (portfolio_id, symbol, kind, trade_date, quantity, price)
values ('21212121-0000-4000-8000-00000000010b', 'S1', 'buy', '2026-07-02', 1, 120);
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000b', 'S1') = '2@110', 'plan: buying more of a held stock is fine');
reset role;
select qp_t21.check((select count(*) > 0 from public.portfolio_transactions where user_id = '21212121-0000-4000-8000-00000000000a'),
                    'isolation: another user''s delete removed nothing');

-- An expired plan: the evening split job still works the holding out (update path, no plan check), no section errors.
update public.subscriptions set status = 'expired', current_period_end = now() - interval '1 day'
 where user_id = '21212121-0000-4000-8000-00000000000b';
insert into public.corporate_actions (symbol, exchange, ex_date, factor)
values ('S2', 'NSE', (now() at time zone 'Asia/Kolkata')::date - 1, 2);
create temp table r21 as select private.run_eod_notifier() as r;
select qp_t21.check(qp_t21.pos('21212121-0000-4000-8000-00000000000b', 'S2') = '2@50'
                and (select jsonb_array_length(r -> 'errors') = 0 from r21),
                    'plan: an expired plan''s holding still follows a split; the notifier reports no errors');

-- ------------------------------------------------------------------ the portfolio goes, everything goes
delete from public.portfolios where id = '21212121-0000-4000-8000-00000000010a';
select qp_t21.check((select count(*) = 0 from public.portfolio_transactions where user_id = '21212121-0000-4000-8000-00000000000a')
                and (select count(*) = 0 from public.portfolio_lots where user_id = '21212121-0000-4000-8000-00000000000a')
                and (select count(*) = 0 from public.holdings where user_id = '21212121-0000-4000-8000-00000000000a'),
                    'delete: removing a portfolio removes its trades, lots and holdings');

do $$ begin raise notice 'PORTFOLIO LEDGER TESTS PASSED'; end $$;
rollback;
