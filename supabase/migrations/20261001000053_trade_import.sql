-- Broker tradebook import (portfolio plan, step C; ADR-047). The browser reads the file; these three calls check it,
-- save it in one go, and undo it.
--   * public.preview_trades: a dry run. Each stock's trades are added in its own step (one stock's problem, such as a
--     sale of shares bought before the file starts, does not hide the others), the result is read, and everything is
--     rolled back. Nothing is stored.
--   * public.import_trades: one import, all or nothing. Rows already stored (same broker reference) are skipped. For the
--     stocks the person chose, the tradebook replaces their opening balance; those opening rows are kept on the import so
--     an undo puts them back.
--   * public.undo_import: puts the replaced opening balances back, then removes the import with its trades. Refused,
--     leaving everything as it was, when a later sale needs the imported shares.
-- Security definer with the owner, workspace, membership and plan checked first; every row is written with the
-- caller's own user and workspace.

alter table public.portfolio_imports add column replaced_openings jsonb not null default '[]'::jsonb;

-- The caller owns this portfolio in the active workspace and may track a portfolio.
create or replace function private.can_write_portfolio(p_portfolio uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.portfolios p
                 where p.id = p_portfolio and p.user_id = (select auth.uid()) and p.tenant_id = private.active_tenant_id())
     and private.is_tenant_member(private.active_tenant_id())
     and private.plan_has_feature('portfolio')
$$;
revoke all on function private.can_write_portfolio(uuid) from public, anon, authenticated;

-- Rows: [{symbol, kind ('buy'|'sell'), trade_date, quantity, price, charges?, broker_ref?}]
create or replace function private.valid_trade_rows(p_rows jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) between 1 and 20000
     and not exists (select 1 from jsonb_array_elements(p_rows) r
                     where coalesce(r ->> 'kind', '') not in ('buy', 'sell')
                        or coalesce(r ->> 'symbol', '') !~ '^[A-Z0-9&\-\.]{1,20}$'
                        or coalesce(r ->> 'trade_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
                        or private.try_numeric(r ->> 'quantity') is null or private.try_numeric(r ->> 'price') is null)
$$;
revoke all on function private.valid_trade_rows(jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------ dry run
create or replace function public.preview_trades(p_portfolio uuid, p_rows jsonb, p_replace text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user   uuid := auth.uid();
  v_tenant uuid := private.active_tenant_id();
  s        record;
  v_out    jsonb := '[]'::jsonb;
  v_before jsonb;
  v_n      integer;
begin
  if not private.can_write_portfolio(p_portfolio) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if not private.valid_trade_rows(p_rows) then
    raise exception 'INVALID_INPUT: trade rows' using errcode = 'P0001';
  end if;

  begin
    for s in select r ->> 'symbol' as symbol, count(*) as n from jsonb_array_elements(p_rows) r group by 1 order by 1 loop
      v_before := null;
      select jsonb_build_object(
               'quantity', h.quantity, 'avg_price', h.avg_price,
               'opening_only', not exists (select 1 from public.portfolio_transactions t
                                           where t.portfolio_id = p_portfolio and t.user_id = v_user and t.tenant_id = v_tenant
                                             and t.symbol = s.symbol and t.exchange = 'NSE' and t.kind <> 'opening'))
        into v_before
      from public.holdings h
      where h.portfolio_id = p_portfolio and h.user_id = v_user and h.tenant_id = v_tenant and h.symbol = s.symbol and h.exchange = 'NSE';
      begin
        if s.symbol = any (p_replace) then
          delete from public.portfolio_transactions t
          where t.portfolio_id = p_portfolio and t.user_id = v_user and t.tenant_id = v_tenant
            and t.symbol = s.symbol and t.exchange = 'NSE' and t.kind = 'opening';
        end if;
        with ins as (
          insert into public.portfolio_transactions (tenant_id, user_id, portfolio_id, symbol, exchange, kind, trade_date,
                                                     quantity, price, charges, source, broker_ref)
          select v_tenant, v_user, p_portfolio, s.symbol, 'NSE', r ->> 'kind', (r ->> 'trade_date')::date,
                 (r ->> 'quantity')::numeric, (r ->> 'price')::numeric, coalesce(private.try_numeric(r ->> 'charges'), 0),
                 'tradebook', nullif(r ->> 'broker_ref', '')
          from jsonb_array_elements(p_rows) with ordinality as e(r, i)
          where r ->> 'symbol' = s.symbol
          order by (r ->> 'trade_date')::date, i
          on conflict do nothing
          returning 1
        )
        select count(*) into v_n from ins;
        v_out := v_out || jsonb_build_object(
          'symbol', s.symbol, 'ok', true, 'rows', s.n, 'added', v_n, 'duplicates', s.n - v_n, 'before', v_before,
          'after', (select jsonb_build_object('quantity', h.quantity, 'avg_price', h.avg_price) from public.holdings h
                    where h.portfolio_id = p_portfolio and h.user_id = v_user and h.tenant_id = v_tenant
                      and h.symbol = s.symbol and h.exchange = 'NSE'),
          'realized', (select coalesce(sum(x.gain), 0) from public.portfolio_realized x
                       where x.portfolio_id = p_portfolio and x.user_id = v_user and x.tenant_id = v_tenant
                         and x.symbol = s.symbol and x.exchange = 'NSE'),
          'sales', (select count(distinct x.sell_txn_id) from public.portfolio_realized x
                    where x.portfolio_id = p_portfolio and x.user_id = v_user and x.tenant_id = v_tenant
                      and x.symbol = s.symbol and x.exchange = 'NSE'));
      exception when others then
        v_out := v_out || jsonb_build_object('symbol', s.symbol, 'ok', false, 'rows', s.n, 'error', sqlerrm, 'before', v_before);
      end;
    end loop;
    raise exception 'QP_DRY_RUN';
  exception when others then
    if sqlerrm <> 'QP_DRY_RUN' then raise; end if;
  end;
  return v_out;
end $$;
revoke all on function public.preview_trades(uuid, jsonb, text[]) from public, anon;
grant execute on function public.preview_trades(uuid, jsonb, text[]) to authenticated;

-- ------------------------------------------------------------------ the import
create or replace function public.import_trades(p_portfolio uuid, p_broker text, p_rows jsonb, p_replace text[] default '{}',
                                               p_skipped integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user     uuid := auth.uid();
  v_tenant   uuid := private.active_tenant_id();
  v_id       uuid;
  v_total    integer;
  v_added    integer;
  v_replaced jsonb;
begin
  if not private.can_write_portfolio(p_portfolio) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if not private.valid_trade_rows(p_rows) then
    raise exception 'INVALID_INPUT: trade rows' using errcode = 'P0001';
  end if;
  v_total := jsonb_array_length(p_rows);

  insert into public.portfolio_imports (tenant_id, user_id, portfolio_id, broker, skipped, date_from, date_to)
  select v_tenant, v_user, p_portfolio, p_broker, greatest(coalesce(p_skipped, 0), 0),
         min((r ->> 'trade_date')::date), max((r ->> 'trade_date')::date)
  from jsonb_array_elements(p_rows) r
  returning id into v_id;

  -- Opening balances the tradebook replaces, kept so an undo can put them back.
  with gone as (
    delete from public.portfolio_transactions t
    where t.portfolio_id = p_portfolio and t.user_id = v_user and t.tenant_id = v_tenant and t.exchange = 'NSE'
      and t.kind = 'opening' and t.symbol = any (coalesce(p_replace, '{}'))
      and exists (select 1 from jsonb_array_elements(p_rows) r where r ->> 'symbol' = t.symbol)
    returning t.symbol, t.trade_date, t.quantity, t.price, t.charges, t.note
  )
  select coalesce(jsonb_agg(to_jsonb(gone)), '[]'::jsonb) into v_replaced from gone;

  with ins as (
    insert into public.portfolio_transactions (tenant_id, user_id, portfolio_id, symbol, exchange, kind, trade_date,
                                               quantity, price, charges, source, broker_ref, import_id)
    select v_tenant, v_user, p_portfolio, r ->> 'symbol', 'NSE', r ->> 'kind', (r ->> 'trade_date')::date,
           (r ->> 'quantity')::numeric, (r ->> 'price')::numeric, coalesce(private.try_numeric(r ->> 'charges'), 0),
           'tradebook', nullif(r ->> 'broker_ref', ''), v_id
    from jsonb_array_elements(p_rows) with ordinality as e(r, i)
    order by (r ->> 'trade_date')::date, i
    on conflict do nothing
    returning 1
  )
  select count(*) into v_added from ins;

  if v_added = 0 and jsonb_array_length(v_replaced) = 0 then
    delete from public.portfolio_imports where id = v_id;
    return jsonb_build_object('import_id', null, 'added', 0, 'duplicates', v_total, 'replaced', 0);
  end if;
  update public.portfolio_imports
     set trades_added = v_added, duplicates = v_total - v_added, replaced_openings = v_replaced
   where id = v_id;
  return jsonb_build_object('import_id', v_id, 'added', v_added, 'duplicates', v_total - v_added,
                            'replaced', jsonb_array_length(v_replaced));
end $$;
revoke all on function public.import_trades(uuid, text, jsonb, text[], integer) from public, anon;
grant execute on function public.import_trades(uuid, text, jsonb, text[], integer) to authenticated;

-- ------------------------------------------------------------------ undo
create or replace function public.undo_import(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user   uuid := auth.uid();
  v_tenant uuid := private.active_tenant_id();
  i        public.portfolio_imports;
begin
  select * into i from public.portfolio_imports x where x.id = p_id and x.user_id = v_user and x.tenant_id = v_tenant;
  if i.id is null or not private.is_tenant_member(v_tenant) then
    raise exception 'import not found' using errcode = 'P0002';
  end if;
  insert into public.portfolio_transactions (tenant_id, user_id, portfolio_id, symbol, exchange, kind, trade_date,
                                             quantity, price, charges, note, source)
  select v_tenant, v_user, i.portfolio_id, o ->> 'symbol', 'NSE', 'opening', (o ->> 'trade_date')::date,
         (o ->> 'quantity')::numeric, (o ->> 'price')::numeric, coalesce((o ->> 'charges')::numeric, 0), o ->> 'note', 'opening'
  from jsonb_array_elements(i.replaced_openings) o;
  delete from public.portfolio_imports x where x.id = i.id;   -- its trades go with it (foreign key cascade)
end $$;
revoke all on function public.undo_import(uuid) from public, anon;
grant execute on function public.undo_import(uuid) to authenticated;
