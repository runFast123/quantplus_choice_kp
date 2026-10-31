-- Two years of history for the 500 largest companies (migration 32). Rolled back.
begin;

create schema qp_t9;
create function qp_t9.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t9.days(p_symbol text) returns int language sql stable as $$
  select history_days from public.market_symbols where symbol = p_symbol and exchange = 'NSE'
$$;

insert into public.market_symbols (symbol, exchange, name, is_active, mcap_rank, history_days) values
  ('QPBIG', 'NSE', 'Top-500 fixture', true, 120, 400),
  ('QPSMALL', 'NSE', 'Small fixture', true, 1800, 400),
  ('QPNORANK', 'NSE', 'Unranked fixture', true, null, 400);

select qp_t9.check(qp_t9.days('QPBIG') = 760, 'insert: a top-500 company gets two years');
select qp_t9.check(qp_t9.days('QPSMALL') = 400, 'insert: a smaller company keeps 400 days');
select qp_t9.check(qp_t9.days('QPNORANK') = 400, 'insert: no rank, no change');

update public.market_symbols set mcap_rank = 499 where symbol = 'QPSMALL';
select qp_t9.check(qp_t9.days('QPSMALL') = 760, 'update: climbing into the top 500 raises it');

update public.market_symbols set mcap_rank = 2400 where symbol = 'QPBIG';
select qp_t9.check(qp_t9.days('QPBIG') = 760, 'update: falling out never lowers it');

-- The universe sync upserts the stored history_days back; the trigger still wins.
insert into public.market_symbols (symbol, exchange, name, is_active, mcap_rank, history_days)
values ('QPSMALL', 'NSE', 'Small fixture', true, 300, 400)
on conflict (symbol, exchange) do update set history_days = excluded.history_days, mcap_rank = excluded.mcap_rank;
select qp_t9.check(qp_t9.days('QPSMALL') = 760, 'upsert: a top-500 row stays at two years');

select qp_t9.check(not has_function_privilege('authenticated', 'private.history_for_rank()', 'execute'), 'grants: users cannot call the trigger function');

rollback;
