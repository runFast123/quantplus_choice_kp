-- The portfolio ledger (portfolio plan, step A; ADR-046). Every buy, sell and opening balance is a dated row in
-- public.portfolio_transactions; lots, realized gains and the holding itself are worked out from those rows and the
-- stored splits and bonus issues (public.corporate_actions).
--   * Lots are matched oldest first (FIFO): the method Zerodha Console's P&L and Indian tax use for demat shares, and the
--     only one that gives each purchase its own result (needed to set each buy beside the rules' trades, step D).
--   * Within a day: splits first (an ex-date's numbers are already in the new shares), then opening balances, buys, and
--     sells last, so an intraday sell-then-buy-back is one lot bought and sold the same day.
--   * public.holdings stays the table everything else reads (alerts, research, notifier, limits); private.rebuild_position
--     keeps it equal to the ledger. Its average price is the price paid, without charges (what brokers show); charges
--     count in realized gains.
--   * Every stored split applies to the shares held before its ex-date, whatever the order the trades were entered in:
--     a tradebook spanning a 2025 split imports in one go. private.corporate_action_ledger records, per portfolio and
--     stock, that a split was seen (so it is announced once) or undone (then the replay leaves it out). Only splits a
--     person lived through (entered before the ex-date, ex-date in the last 30 days) are announced and listed with Undo.
--   * Existing holdings become opening balances dated the day they were last edited (private.ensure_opening_balances,
--     also run by the notifier as a safety net). A holding still carrying step 1's split adjustment gets the numbers
--     from before the split, dated the day before it, so the replay applies the split and its Undo keeps working.
--   * An opening balance means "what I hold as of this date", in that day's shares. The app must date one the day it is
--     entered (step B): an opening dated in the past with today's numbers would be rescaled for splits since.
-- Direct client writes to holdings stay allowed until the app writes trades (migration 52, step B).

-- ------------------------------------------------------------------ imports
create table public.portfolio_imports (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default private.active_tenant_id(),
  user_id      uuid not null default auth.uid(),
  portfolio_id uuid not null,
  broker       text not null check (broker in ('zerodha', 'groww', 'upstox', 'angelone', 'choice', 'other', 'contract_note')),
  trades_added integer not null default 0 check (trades_added >= 0),
  duplicates   integer not null default 0 check (duplicates >= 0),
  skipped      integer not null default 0 check (skipped >= 0),
  date_from    date,
  date_to      date,
  created_at   timestamptz not null default now(),
  foreign key (portfolio_id, user_id, tenant_id) references public.portfolios (id, user_id, tenant_id) on delete cascade,
  unique (id, user_id, tenant_id)
);
create index portfolio_imports_owner_idx on public.portfolio_imports (user_id, tenant_id, created_at desc);

-- ------------------------------------------------------------------ transactions
create table public.portfolio_transactions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default private.active_tenant_id(),
  user_id      uuid not null default auth.uid(),
  portfolio_id uuid not null,
  symbol       text not null check (symbol ~ '^[A-Z0-9&\-\.]{1,20}$'),
  exchange     public.exchange_code not null default 'NSE',
  kind         text not null check (kind in ('opening', 'buy', 'sell')),
  trade_date   date not null check (trade_date >= date '1990-01-01'),
  quantity     numeric(18,4) not null check (quantity > 0),
  price        numeric(18,4) not null check (price >= 0),
  charges      numeric(18,4) not null default 0 check (charges >= 0),
  note         text check (char_length(note) <= 200),
  sip          boolean not null default false,
  source       text not null default 'manual' check (source in ('manual', 'tradebook', 'contract_note', 'opening')),
  broker_ref   text check (char_length(broker_ref) between 1 and 64),
  import_id    uuid,
  seq          bigint generated always as identity,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (portfolio_id, user_id, tenant_id) references public.portfolios (id, user_id, tenant_id) on delete cascade,
  foreign key (import_id, user_id, tenant_id) references public.portfolio_imports (id, user_id, tenant_id) on delete cascade
);
create index portfolio_transactions_position_idx
  on public.portfolio_transactions (portfolio_id, user_id, tenant_id, symbol, exchange, trade_date);
create index portfolio_transactions_owner_idx on public.portfolio_transactions (user_id, tenant_id);
create index portfolio_transactions_import_idx on public.portfolio_transactions (import_id) where import_id is not null;
-- The same broker trade is never stored twice in a portfolio (a re-imported tradebook adds nothing).
create unique index portfolio_transactions_broker_ref_key
  on public.portfolio_transactions (portfolio_id, user_id, tenant_id, symbol, trade_date, kind, broker_ref)
  where broker_ref is not null;
create trigger trg_portfolio_transactions_updated_at before update on public.portfolio_transactions
  for each row execute function private.set_updated_at();

-- No trade dated after today (IST). A trigger, not a CHECK: the limit moves with the clock.
create or replace function private.portfolio_transaction_date_ok() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.trade_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'TRADE_IN_FUTURE: % is after today', new.trade_date using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.portfolio_transaction_date_ok() from public, anon, authenticated;
create trigger trg_portfolio_transactions_date before insert or update of trade_date on public.portfolio_transactions
  for each row execute function private.portfolio_transaction_date_ok();

-- ------------------------------------------------------------------ derived: lots and realized gains
create table public.portfolio_lots (
  buy_txn_id    uuid primary key,
  tenant_id     uuid not null,
  user_id       uuid not null,
  portfolio_id  uuid not null,
  symbol        text not null,
  exchange      public.exchange_code not null,
  buy_date      date not null,
  kind          text not null check (kind in ('opening', 'buy')),
  buy_quantity  numeric(18,4) not null,       -- as bought
  buy_price     numeric(18,4) not null,       -- as bought, without charges
  open_quantity numeric(18,4) not null,       -- still held, in today's shares (after splits)
  open_price    numeric(18,4) not null,       -- price per today's share, without charges
  charges       numeric(18,4) not null,       -- the buy's charges
  foreign key (portfolio_id, user_id, tenant_id) references public.portfolios (id, user_id, tenant_id) on delete cascade
);
create index portfolio_lots_position_idx on public.portfolio_lots (portfolio_id, user_id, tenant_id, symbol, exchange);
create index portfolio_lots_owner_idx on public.portfolio_lots (user_id, tenant_id);

create table public.portfolio_realized (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null,
  user_id       uuid not null,
  portfolio_id  uuid not null,
  symbol        text not null,
  exchange      public.exchange_code not null,
  sell_txn_id   uuid not null,
  buy_txn_id    uuid not null,
  buy_date      date not null,
  sell_date     date not null,
  quantity      numeric(18,4) not null,       -- shares sold out of this lot (in the shares of the sell day)
  buy_price     numeric(18,4) not null,       -- per share of the sell day, without charges
  sell_price    numeric(18,4) not null,
  cost          numeric(18,4) not null,       -- quantity × buy price + its share of the buy's charges
  proceeds      numeric(18,4) not null,       -- quantity × sell price − its share of the sell's charges
  gain          numeric(18,4) not null,
  days_held     integer not null,
  foreign key (portfolio_id, user_id, tenant_id) references public.portfolios (id, user_id, tenant_id) on delete cascade
);
create index portfolio_realized_position_idx on public.portfolio_realized (portfolio_id, user_id, tenant_id, symbol, exchange);
create index portfolio_realized_owner_idx on public.portfolio_realized (user_id, tenant_id, sell_date desc);

-- ------------------------------------------------------------------ security
do $$
declare
  own text := '(user_id = (select auth.uid())'
           || ' and tenant_id = (select private.active_tenant_id())'
           || ' and (select private.is_tenant_member(private.active_tenant_id())))';
  t text;
begin
  foreach t in array array['portfolio_imports', 'portfolio_transactions', 'portfolio_lots', 'portfolio_realized'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using %s', t || '_select_own', t, own);
    execute format('grant select on public.%I to authenticated', t);
  end loop;

  -- Imports: created and undone (deleted, with their trades) by their owner.
  execute format('create policy portfolio_imports_insert_own on public.portfolio_imports for insert to authenticated '
                 'with check (%s and (select private.plan_has_feature(%L)))', own, 'portfolio');
  execute format('create policy portfolio_imports_delete_own on public.portfolio_imports for delete to authenticated using %s', own);
  grant insert, delete on public.portfolio_imports to authenticated;

  -- Trades: the owner records, corrects and deletes them.
  execute format('create policy portfolio_transactions_insert_own on public.portfolio_transactions for insert to authenticated '
                 'with check (%s and (select private.plan_has_feature(%L)))', own, 'portfolio');
  execute format('create policy portfolio_transactions_update_own on public.portfolio_transactions for update to authenticated '
                 'using %s with check %s', own, own);
  execute format('create policy portfolio_transactions_delete_own on public.portfolio_transactions for delete to authenticated '
                 'using %s', own);
  grant insert, delete on public.portfolio_transactions to authenticated;
  -- The stock, side and source of a stored trade never change (same reason as holdings in migration 22).
  grant update (trade_date, quantity, price, charges, note, sip) on public.portfolio_transactions to authenticated;
end $$;

-- Per portfolio and stock: a split was seen (announced once) or undone (left out of the replay from then on).
create table private.corporate_action_ledger (
  portfolio_id uuid not null,
  user_id      uuid not null,
  tenant_id    uuid not null,
  symbol       text not null,
  exchange     public.exchange_code not null,
  ex_date      date not null,
  applied      boolean not null default true,
  decided_at   timestamptz not null default now(),
  primary key (portfolio_id, user_id, tenant_id, symbol, exchange, ex_date),
  foreign key (portfolio_id, user_id, tenant_id) references public.portfolios (id, user_id, tenant_id) on delete cascade
);
alter table private.corporate_action_ledger enable row level security;
revoke all on private.corporate_action_ledger from public, anon, authenticated;

-- ------------------------------------------------------------------ the replay
-- The position's events in replay order: its trades, plus every stored split the person has not undone.
create or replace function private.position_events(p_portfolio uuid, p_user uuid, p_tenant uuid, p_symbol text,
                                                  p_exchange public.exchange_code, p_before date default null)
returns table (id uuid, kind text, trade_date date, quantity numeric, price numeric, charges numeric, factor numeric)
language sql stable security definer set search_path = '' as $$
  select e.id, e.kind, e.trade_date, e.quantity, e.price, e.charges, e.factor
  from (
    select x.id, x.kind, x.trade_date, x.quantity::numeric as quantity, x.price::numeric as price,
           x.charges::numeric as charges, null::numeric as factor, x.seq
    from public.portfolio_transactions x
    where x.portfolio_id = p_portfolio and x.user_id = p_user and x.tenant_id = p_tenant
      and x.symbol = p_symbol and x.exchange = p_exchange
    union all
    select null::uuid, 'split', a.ex_date, null::numeric, null::numeric, 0::numeric, a.factor, 0::bigint
    from public.corporate_actions a
    where a.symbol = p_symbol and a.exchange = p_exchange
      and not exists (select 1 from private.corporate_action_ledger l
                      where l.portfolio_id = p_portfolio and l.user_id = p_user and l.tenant_id = p_tenant
                        and l.symbol = a.symbol and l.exchange = a.exchange and l.ex_date = a.ex_date and not l.applied)
  ) e
  where p_before is null or e.trade_date < p_before
  order by e.trade_date, case e.kind when 'split' then 0 when 'opening' then 1 when 'buy' then 2 else 3 end, e.seq
$$;
revoke all on function private.position_events(uuid, uuid, uuid, text, public.exchange_code, date) from public, anon, authenticated;

-- Rebuild one position (portfolio × stock) from its events: lots, realized gains and the holding row. Raises
-- SELL_EXCEEDS_HOLDING when a sell is larger than the shares held at that point, so the write that caused it fails.
-- Whole-share positions stay whole after a split; the fraction (paid in cash by the company) leaves the newest lot and
-- its cost stays with the shares.
create or replace function private.rebuild_position(p_portfolio uuid, p_user uuid, p_tenant uuid, p_symbol text,
                                                   p_exchange public.exchange_code) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t      record;
  l_txn  uuid[]    := '{}';
  l_date date[]    := '{}';
  l_kind text[]    := '{}';
  l_bq   numeric[] := '{}';
  l_bp   numeric[] := '{}';
  l_rem  numeric[] := '{}';
  l_px   numeric[] := '{}';   -- price per current share, without charges
  l_cps  numeric[] := '{}';   -- buy charges per current share
  l_chg  numeric[] := '{}';
  n      integer := 0;
  i      integer;
  held   numeric;
  after  numeric;
  frac   numeric;
  need   numeric;
  take   numeric;
  sell_c numeric;
  v_qty  numeric := 0;
  v_val  numeric := 0;
  v_avg  numeric;
  v_src  text;
begin
  if not exists (select 1 from public.portfolios p where p.id = p_portfolio and p.user_id = p_user and p.tenant_id = p_tenant) then
    return;   -- the portfolio itself is being deleted; its rows go with it
  end if;
  delete from public.portfolio_realized r where r.portfolio_id = p_portfolio and r.user_id = p_user and r.tenant_id = p_tenant
    and r.symbol = p_symbol and r.exchange = p_exchange;
  delete from public.portfolio_lots l where l.portfolio_id = p_portfolio and l.user_id = p_user and l.tenant_id = p_tenant
    and l.symbol = p_symbol and l.exchange = p_exchange;

  for t in select * from private.position_events(p_portfolio, p_user, p_tenant, p_symbol, p_exchange) loop
    if t.kind in ('opening', 'buy') then
      n := n + 1;
      l_txn[n] := t.id; l_date[n] := t.trade_date; l_kind[n] := t.kind;
      l_bq[n] := t.quantity; l_bp[n] := t.price; l_rem[n] := t.quantity; l_px[n] := t.price;
      l_cps[n] := t.charges / t.quantity; l_chg[n] := t.charges;
    elsif t.kind = 'split' then
      held := 0;
      for i in 1 .. n loop held := held + l_rem[i]; end loop;
      if held > 0 then
        after := 0;
        for i in 1 .. n loop
          if l_rem[i] > 0 then
            l_rem[i] := l_rem[i] * t.factor; l_px[i] := l_px[i] / t.factor; l_cps[i] := l_cps[i] / t.factor;
            after := after + l_rem[i];
          end if;
        end loop;
        frac := after - floor(after);
        if held = trunc(held) and frac > 0 then
          for i in reverse n .. 1 loop
            if l_rem[i] > frac then
              l_px[i]  := l_px[i]  * l_rem[i] / (l_rem[i] - frac);
              l_cps[i] := l_cps[i] * l_rem[i] / (l_rem[i] - frac);
              l_rem[i] := l_rem[i] - frac;
              exit;
            end if;
          end loop;
        end if;
      end if;
    else
      held := 0;
      for i in 1 .. n loop held := held + l_rem[i]; end loop;
      if held + 0.00005 < t.quantity then
        raise exception 'SELL_EXCEEDS_HOLDING: % sold % on % but held %', p_symbol, t.quantity, t.trade_date, round(held, 4)
          using errcode = 'P0001';
      end if;
      need := t.quantity;
      sell_c := t.charges / t.quantity;
      for i in 1 .. n loop
        exit when need <= 0;
        continue when l_rem[i] <= 0;
        take := least(need, l_rem[i]);
        insert into public.portfolio_realized (tenant_id, user_id, portfolio_id, symbol, exchange, sell_txn_id, buy_txn_id,
                                               buy_date, sell_date, quantity, buy_price, sell_price, cost, proceeds, gain, days_held)
        values (p_tenant, p_user, p_portfolio, p_symbol, p_exchange, t.id, l_txn[i], l_date[i], t.trade_date, take,
                round(l_px[i], 4), t.price, round(take * (l_px[i] + l_cps[i]), 4), round(take * (t.price - sell_c), 4),
                round(take * (t.price - sell_c), 4) - round(take * (l_px[i] + l_cps[i]), 4), t.trade_date - l_date[i]);
        l_rem[i] := l_rem[i] - take;
        need := need - take;
      end loop;
    end if;
  end loop;

  for i in 1 .. n loop
    insert into public.portfolio_lots (buy_txn_id, tenant_id, user_id, portfolio_id, symbol, exchange, buy_date, kind,
                                       buy_quantity, buy_price, open_quantity, open_price, charges)
    values (l_txn[i], p_tenant, p_user, p_portfolio, p_symbol, p_exchange, l_date[i], l_kind[i], l_bq[i], l_bp[i],
            round(greatest(l_rem[i], 0), 4), round(l_px[i], 4), l_chg[i]);
    if l_rem[i] > 0 then
      v_qty := v_qty + l_rem[i];
      v_val := v_val + l_rem[i] * l_px[i];
    end if;
  end loop;

  v_qty := round(v_qty, 4);
  if v_qty <= 0 then
    delete from public.holdings h where h.portfolio_id = p_portfolio and h.user_id = p_user and h.tenant_id = p_tenant
      and h.symbol = p_symbol and h.exchange = p_exchange;
    return;
  end if;
  v_avg := round(v_val / v_qty, 4);
  v_src := case when exists (select 1 from public.portfolio_transactions x
                             where x.portfolio_id = p_portfolio and x.user_id = p_user and x.tenant_id = p_tenant
                               and x.symbol = p_symbol and x.exchange = p_exchange
                               and x.source in ('tradebook', 'contract_note')) then 'import' else 'manual' end;
  -- Update first: an INSERT fires the plan's symbol limit, which must only count a stock that is new to the person.
  if exists (select 1 from public.holdings h where h.portfolio_id = p_portfolio and h.user_id = p_user
               and h.tenant_id = p_tenant and h.symbol = p_symbol and h.exchange = p_exchange) then
    update public.holdings h
       set quantity = v_qty, avg_price = v_avg, source = v_src
     where h.portfolio_id = p_portfolio and h.user_id = p_user and h.tenant_id = p_tenant
       and h.symbol = p_symbol and h.exchange = p_exchange
       and (h.quantity, h.avg_price, h.source) is distinct from (v_qty, v_avg, v_src);
  else
    insert into public.holdings (tenant_id, user_id, portfolio_id, symbol, exchange, quantity, avg_price, sector, source)
    values (p_tenant, p_user, p_portfolio, p_symbol, p_exchange, v_qty, v_avg,
            (select m.sector from public.market_symbols m where m.symbol = p_symbol and m.exchange = p_exchange), v_src);
  end if;
end $$;
revoke all on function private.rebuild_position(uuid, uuid, uuid, text, public.exchange_code) from public, anon, authenticated;

-- One rebuild per touched position per statement (a 300-row import rebuilds each stock once).
create or replace function private.portfolio_transactions_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if tg_op = 'INSERT' then
    for r in select distinct portfolio_id, user_id, tenant_id, symbol, exchange from new_rows loop
      perform private.rebuild_position(r.portfolio_id, r.user_id, r.tenant_id, r.symbol, r.exchange);
    end loop;
  elsif tg_op = 'DELETE' then
    for r in select distinct portfolio_id, user_id, tenant_id, symbol, exchange from old_rows loop
      perform private.rebuild_position(r.portfolio_id, r.user_id, r.tenant_id, r.symbol, r.exchange);
    end loop;
  else
    for r in select portfolio_id, user_id, tenant_id, symbol, exchange from new_rows
             union select portfolio_id, user_id, tenant_id, symbol, exchange from old_rows loop
      perform private.rebuild_position(r.portfolio_id, r.user_id, r.tenant_id, r.symbol, r.exchange);
    end loop;
  end if;
  return null;
end $$;
revoke all on function private.portfolio_transactions_changed() from public, anon, authenticated;

create trigger trg_portfolio_transactions_ins after insert on public.portfolio_transactions
  referencing new table as new_rows for each statement execute function private.portfolio_transactions_changed();
create trigger trg_portfolio_transactions_upd after update on public.portfolio_transactions
  referencing new table as new_rows old table as old_rows for each statement execute function private.portfolio_transactions_changed();
create trigger trg_portfolio_transactions_del after delete on public.portfolio_transactions
  referencing old table as old_rows for each statement execute function private.portfolio_transactions_changed();

-- Shares held at the end of the day before p_day (earlier splits applied, whole shares kept whole).
create or replace function private.held_before(p_portfolio uuid, p_user uuid, p_tenant uuid, p_symbol text,
                                              p_exchange public.exchange_code, p_day date) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  t record;
  q numeric := 0;
begin
  for t in select e.kind, e.quantity, e.factor
           from private.position_events(p_portfolio, p_user, p_tenant, p_symbol, p_exchange, p_day) e loop
    if t.kind = 'split' then
      q := case when q = trunc(q) then floor(q * t.factor) else q * t.factor end;
    elsif t.kind = 'sell' then
      q := q - t.quantity;
    else
      q := q + t.quantity;
    end if;
  end loop;
  return round(q, 4);
end $$;
revoke all on function private.held_before(uuid, uuid, uuid, text, public.exchange_code, date) from public, anon, authenticated;

-- ------------------------------------------------------------------ opening balances
-- Every holding with shares and no trades gets one opening balance: its quantity and average as they stand, dated the
-- day it was last edited (the day those numbers were true). A holding still carrying step 1's split adjustment gets the
-- numbers from before the split, dated the day before it, so the replay applies the split and Undo still works.
create or replace function private.ensure_opening_balances() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  h record;
  n integer := 0;
begin
  for h in
    select x.id, x.tenant_id, x.user_id, x.portfolio_id, x.symbol, x.exchange, x.quantity, x.avg_price, x.updated_at,
           a.id as adj_id, a.ex_date, a.old_quantity, a.old_avg_price
    from public.holdings x
    left join lateral (
      select * from public.holding_adjustments a
      where a.holding_id = x.id and a.undone_at is null
        and a.new_quantity = x.quantity and a.new_avg_price = x.avg_price
      order by a.ex_date desc limit 1
    ) a on true
    where x.quantity > 0
      and not exists (select 1 from public.portfolio_transactions t
                      where t.portfolio_id = x.portfolio_id and t.user_id = x.user_id and t.tenant_id = x.tenant_id
                        and t.symbol = x.symbol and t.exchange = x.exchange)
  loop
    begin
      if h.adj_id is null then
        insert into public.portfolio_transactions (tenant_id, user_id, portfolio_id, symbol, exchange, kind, trade_date,
                                                   quantity, price, source)
        values (h.tenant_id, h.user_id, h.portfolio_id, h.symbol, h.exchange, 'opening',
                least((h.updated_at at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date),
                h.quantity, h.avg_price, 'opening');
      else
        insert into private.corporate_action_ledger (portfolio_id, user_id, tenant_id, symbol, exchange, ex_date)
        values (h.portfolio_id, h.user_id, h.tenant_id, h.symbol, h.exchange, h.ex_date) on conflict do nothing;
        insert into public.portfolio_transactions (tenant_id, user_id, portfolio_id, symbol, exchange, kind, trade_date,
                                                   quantity, price, source)
        values (h.tenant_id, h.user_id, h.portfolio_id, h.symbol, h.exchange, 'opening', h.ex_date - 1,
                h.old_quantity, h.old_avg_price, 'opening');
      end if;
      n := n + 1;
    exception when others then
      raise warning 'opening balance for holding % skipped: %', h.id, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function private.ensure_opening_balances() from public, anon, authenticated;

-- ------------------------------------------------------------------ splits (replaces migration 50's)
-- For every stored split and every portfolio with shares from before its ex-date, once: work the position out again
-- (the replay includes the split) and, if the person lived through it (they entered the stock before the ex-date,
-- ex-date within 30 days) and the holding changed, record it with Undo and tell them. An older split, found because an
-- imported trade predates it, applies quietly and shows in the stock's history. One position's failure never stops
-- the others.
create or replace function private.apply_corporate_actions() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c       record;
  v_held  numeric;
  v_hid   uuid;
  v_oq    numeric;
  v_op    numeric;
  v_nq    numeric;
  v_np    numeric;
  v_adj   uuid;
  v_announce boolean;
  v_n     integer := 0;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  for c in
    select distinct a.symbol, a.exchange, a.ex_date, a.factor, t.portfolio_id, t.user_id, t.tenant_id
    from public.corporate_actions a
    join public.portfolio_transactions t on t.symbol = a.symbol and t.exchange = a.exchange
                                         and t.kind in ('opening', 'buy') and t.trade_date < a.ex_date
    where a.ex_date <= v_today
      and not exists (select 1 from private.corporate_action_ledger l
                      where l.portfolio_id = t.portfolio_id and l.user_id = t.user_id and l.tenant_id = t.tenant_id
                        and l.symbol = a.symbol and l.exchange = a.exchange and l.ex_date = a.ex_date)
    order by a.ex_date
  loop
    begin
      v_held := private.held_before(c.portfolio_id, c.user_id, c.tenant_id, c.symbol, c.exchange, c.ex_date);
      v_hid := null; v_oq := null; v_op := null; v_nq := null; v_np := null;
      -- Announced only when the person had shares the day before, entered the stock before the split, and it is recent.
      v_announce := v_held > 0 and c.ex_date >= v_today - 30
         and exists (select 1 from public.portfolio_transactions t
                     where t.portfolio_id = c.portfolio_id and t.user_id = c.user_id and t.tenant_id = c.tenant_id
                       and t.symbol = c.symbol and t.exchange = c.exchange and t.kind in ('opening', 'buy')
                       and t.trade_date < c.ex_date
                       -- an opening balance's date is when its numbers were true; a trade must have been entered before
                       and (t.kind = 'opening' or t.created_at < (c.ex_date + time '09:15') at time zone 'Asia/Kolkata'));
      -- The numbers before: the position replayed without this split (any trade written since may already include it).
      insert into private.corporate_action_ledger (portfolio_id, user_id, tenant_id, symbol, exchange, ex_date, applied)
      values (c.portfolio_id, c.user_id, c.tenant_id, c.symbol, c.exchange, c.ex_date, not v_announce);
      if v_announce then
        begin
          perform private.rebuild_position(c.portfolio_id, c.user_id, c.tenant_id, c.symbol, c.exchange);
          select h.id, h.quantity, h.avg_price into v_hid, v_oq, v_op from public.holdings h
          where h.portfolio_id = c.portfolio_id and h.user_id = c.user_id and h.tenant_id = c.tenant_id
            and h.symbol = c.symbol and h.exchange = c.exchange;
        exception when others then
          v_hid := null;   -- a later sell needs the split's shares: no "before" to show
        end;
        update private.corporate_action_ledger l set applied = true
        where l.portfolio_id = c.portfolio_id and l.user_id = c.user_id and l.tenant_id = c.tenant_id
          and l.symbol = c.symbol and l.exchange = c.exchange and l.ex_date = c.ex_date;
      end if;
      perform private.rebuild_position(c.portfolio_id, c.user_id, c.tenant_id, c.symbol, c.exchange);

      if v_announce and v_hid is not null then
        select h.quantity, h.avg_price into v_nq, v_np from public.holdings h where h.id = v_hid;
        v_adj := null;
        if v_nq is not null and (v_nq, v_np) is distinct from (v_oq, v_op) then
          insert into public.holding_adjustments (tenant_id, user_id, holding_id, symbol, exchange, ex_date, factor,
                                                  old_quantity, old_avg_price, new_quantity, new_avg_price)
          values (c.tenant_id, c.user_id, v_hid, c.symbol, c.exchange, c.ex_date, c.factor, v_oq, v_op, v_nq, v_np)
          on conflict (holding_id, ex_date) do nothing
          returning id into v_adj;
        end if;
        if v_adj is not null then
          insert into public.notifications (tenant_id, user_id, type, title, body, data)
          values (c.tenant_id, c.user_id, 'holding_adjusted', c.symbol || ' had a split or bonus issue',
                  'From ' || to_char(c.ex_date, 'DD Mon YYYY') || ' each share became ' || private.fmt_qty(c.factor)
                    || ' shares. We changed your holding from ' || private.fmt_qty(v_oq) || ' to '
                    || private.fmt_qty(v_nq) || ' shares at an average of ₹'
                    || to_char(v_np, 'FM999G99G99G990D00')
                    || '. The money you put in is the same. If this is wrong, undo it from your portfolio.',
                  jsonb_build_object('adjustment_id', v_adj, 'symbol', c.symbol));
          v_n := v_n + 1;
        end if;
      end if;
    exception when others then
      raise warning 'split % % for portfolio % skipped: %', c.symbol, c.ex_date, c.portfolio_id, sqlerrm;
    end;
  end loop;
  return v_n;
end $$;
revoke all on function private.apply_corporate_actions() from public, anon, authenticated;

-- Undo: the split is marked undone for this portfolio and stock and the position is worked out again. Fails, leaving
-- everything as it was, when a later sell only fits with the split's extra shares (SELL_EXCEEDS_HOLDING).
create or replace function public.undo_holding_adjustment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a    public.holding_adjustments;
  v_t  uuid := private.active_tenant_id();
  v_pf uuid;
begin
  select * into a from public.holding_adjustments x
  where x.id = p_id and x.user_id = auth.uid() and x.tenant_id = v_t and x.undone_at is null;
  if a.id is null or not private.is_tenant_member(v_t) then
    raise exception 'adjustment not found' using errcode = 'P0002';
  end if;
  select h.portfolio_id into v_pf from public.holdings h where h.id = a.holding_id;
  if v_pf is null then
    raise exception 'adjustment not found' using errcode = 'P0002';
  end if;
  insert into private.corporate_action_ledger (portfolio_id, user_id, tenant_id, symbol, exchange, ex_date, applied)
  values (v_pf, a.user_id, a.tenant_id, a.symbol, a.exchange, a.ex_date, false)
  on conflict (portfolio_id, user_id, tenant_id, symbol, exchange, ex_date) do update set applied = false, decided_at = now();
  perform private.rebuild_position(v_pf, a.user_id, a.tenant_id, a.symbol, a.exchange);
  update public.holding_adjustments set undone_at = now() where id = a.id;
end $$;
revoke all on function public.undo_holding_adjustment(uuid) from public, anon;
grant execute on function public.undo_holding_adjustment(uuid) to authenticated;

-- Run by the notifier: opening balances first (a holding entered without a trade still gets its splits), then splits.
create or replace function private.ledger_maintenance() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_opening_balances();
  return private.apply_corporate_actions();
end $$;
revoke all on function private.ledger_maintenance() from public, anon, authenticated;

-- The notifier of migration 50 with that one call changed (copied from the stored definition, not retyped).
do $$
declare
  src text;
begin
  select pg_get_functiondef('private.run_eod_notifier()'::regprocedure) into src;
  if position('v_adjust := private.apply_corporate_actions();' in src) = 0 then
    raise exception 'run_eod_notifier is not the migration 50 version';
  end if;
  execute replace(src, 'v_adjust := private.apply_corporate_actions();', 'v_adjust := private.ledger_maintenance();');
end $$;
revoke all on function private.run_eod_notifier() from public, anon, authenticated;

-- ------------------------------------------------------------------ data rights
create or replace function public.export_my_data() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'exported_at',        now(),
    'profile',            (select to_jsonb(p) from public.profiles p),
    'consents',           (select coalesce(jsonb_agg(c), '[]'::jsonb) from public.user_consents c),
    'portfolios',         (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.portfolios x),
    'holdings',           (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.holdings x),
    'portfolio_transactions', (select coalesce(jsonb_agg(x order by x.trade_date, x.seq), '[]'::jsonb) from public.portfolio_transactions x),
    'portfolio_imports',  (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.portfolio_imports x),
    'realized_gains',     (select coalesce(jsonb_agg(x order by x.sell_date), '[]'::jsonb) from public.portfolio_realized x),
    'watchlists',         (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.watchlists x),
    'watchlist_items',    (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.watchlist_items x),
    'price_alerts',       (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.price_alerts x),
    'subscriptions',      (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.subscriptions x),
    'payments',           (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.payments x),
    'ai_provider_keys',   (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.ai_provider_keys x),
    'push_subscriptions', (select coalesce(jsonb_agg(jsonb_build_object(
                             'created_at', x.created_at, 'user_agent', x.user_agent, 'endpoint', x.endpoint)), '[]'::jsonb)
                           from public.push_subscriptions x)
  )
$$;
revoke execute on function public.export_my_data() from public, anon;
grant  execute on function public.export_my_data() to authenticated;

-- ------------------------------------------------------------------ existing holdings → opening balances
select private.ensure_opening_balances();
