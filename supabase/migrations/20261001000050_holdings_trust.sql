-- Holdings you can trust (portfolio plan, step 1; ADR-045).
-- 1. Exit messages about a stock you hold name the live rule, say why its trade closed, and say plainly that it is the
--    rule's own research trade: your holding is unchanged. The old text named only the two retired rules and fell back
--    to the raw key ("kk dip").
-- 2. public.notification_prefs: which rules may message you about stocks you hold. With no row, only the three trend
--    rules do; the dip rules close their trades within ten sessions, too often for someone who holds for years.
-- 3. public.corporate_actions: splits and bonus issues as Yahoo reports them (new shares per old share), written by the
--    EOD pipeline. public.holding_adjustments: every holding the notifier rescaled for one, with the numbers before, so
--    the owner can undo it (public.undo_holding_adjustment). Only holdings last edited before the ex-date session
--    opened are rescaled: a holding edited after it already has the new numbers.

-- ------------------------------------------------------------------ 2. which rules message you
create table public.notification_prefs (
  tenant_id  uuid not null default private.active_tenant_id() references public.tenants(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exit_rules text[] not null default array['strong_trend', 'sma_trend', 'ma200_trend']
             check (exit_rules <@ array['strong_trend', 'sma_trend', 'ma200_trend', 'rsi_dip', 'kk_dip']),
  updated_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);
create trigger trg_notification_prefs_updated_at before update on public.notification_prefs
  for each row execute function private.set_updated_at();

alter table public.notification_prefs enable row level security;
do $$
declare
  own text := '(user_id = (select auth.uid())'
           || ' and tenant_id = (select private.active_tenant_id())'
           || ' and (select private.is_tenant_member(private.active_tenant_id())))';
begin
  execute format('create policy notification_prefs_select_own on public.notification_prefs for select to authenticated using %s', own);
  execute format('create policy notification_prefs_insert_own on public.notification_prefs for insert to authenticated with check %s', own);
  execute format('create policy notification_prefs_update_own on public.notification_prefs for update to authenticated using %s with check %s', own, own);
end $$;
revoke all on public.notification_prefs from anon;
revoke all on public.notification_prefs from authenticated;
grant select, insert on public.notification_prefs to authenticated;
grant update (exit_rules) on public.notification_prefs to authenticated;

-- ------------------------------------------------------------------ 3. splits and bonus issues
create table public.corporate_actions (
  symbol     text not null,
  exchange   public.exchange_code not null default 'NSE',
  ex_date    date not null,
  factor     numeric not null check (factor > 0 and factor <> 1),   -- new shares per old share: 2 = a 1:2 split or 1:1 bonus
  source     text not null default 'yahoo',
  created_at timestamptz not null default now(),
  primary key (symbol, exchange, ex_date)
);
alter table public.corporate_actions enable row level security;
create policy corporate_actions_read on public.corporate_actions for select to authenticated using (true);
revoke all on public.corporate_actions from anon;
revoke insert, update, delete, truncate on public.corporate_actions from authenticated;

create table public.holding_adjustments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  holding_id    uuid not null references public.holdings(id) on delete cascade,
  symbol        text not null,
  exchange      public.exchange_code not null,
  ex_date       date not null,
  factor        numeric not null,
  old_quantity  numeric(18,4) not null,
  old_avg_price numeric(18,4) not null,
  new_quantity  numeric(18,4) not null,
  new_avg_price numeric(18,4) not null,
  applied_at    timestamptz not null default now(),
  undone_at     timestamptz,
  unique (holding_id, ex_date)
);
create index holding_adjustments_owner_idx on public.holding_adjustments (user_id, tenant_id, applied_at desc);

alter table public.holding_adjustments enable row level security;
do $$
declare
  own text := '(user_id = (select auth.uid())'
           || ' and tenant_id = (select private.active_tenant_id())'
           || ' and (select private.is_tenant_member(private.active_tenant_id())))';
begin
  execute format('create policy holding_adjustments_select_own on public.holding_adjustments for select to authenticated using %s', own);
end $$;
revoke all on public.holding_adjustments from anon;
revoke insert, update, delete, truncate on public.holding_adjustments from authenticated;
grant select on public.holding_adjustments to authenticated;

-- 10 → "10", 10.5 → "10.5", 1234567 → "1,234,567" (to_char's FM pattern leaves a trailing "." on whole numbers).
create or replace function private.fmt_qty(p numeric) returns text
language sql immutable set search_path = '' as $$
  select case when p = trunc(p) then to_char(p, 'FM999G99G99G990') else to_char(p, 'FM999G99G99G990.####') end
$$;
revoke all on function private.fmt_qty(numeric) from public, anon, authenticated;

-- Rescale holdings for splits and bonus issues of the last 30 days. Whole-share holdings stay whole (a fraction is
-- paid in cash by the company, not held); the money put in is kept, so the average price is cost / new quantity.
create or replace function private.apply_corporate_actions() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  with due as (
    select h.id as holding_id, h.tenant_id, h.user_id, h.symbol, h.exchange, a.ex_date, a.factor,
           h.quantity as old_q, h.avg_price as old_p,
           case when h.quantity = trunc(h.quantity) then floor(h.quantity * a.factor)
                else round(h.quantity * a.factor, 4) end as new_q
    from public.corporate_actions a
    join public.holdings h on h.symbol = a.symbol and h.exchange = a.exchange and h.quantity > 0
    where a.ex_date between (now() at time zone 'Asia/Kolkata')::date - 30 and (now() at time zone 'Asia/Kolkata')::date
      and h.updated_at < (a.ex_date + time '09:15') at time zone 'Asia/Kolkata'
      and not exists (select 1 from public.holding_adjustments x where x.holding_id = h.id and x.ex_date = a.ex_date)
  ),
  ok as (
    select d.*, round(d.old_q * d.old_p / d.new_q, 4) as new_p from due d where d.new_q > 0
  ),
  rec as (
    insert into public.holding_adjustments (tenant_id, user_id, holding_id, symbol, exchange, ex_date, factor,
                                            old_quantity, old_avg_price, new_quantity, new_avg_price)
    select o.tenant_id, o.user_id, o.holding_id, o.symbol, o.exchange, o.ex_date, o.factor, o.old_q, o.old_p, o.new_q, o.new_p
    from ok o
    on conflict (holding_id, ex_date) do nothing
    returning id, tenant_id, user_id, holding_id, symbol, ex_date, factor, old_quantity, new_quantity, new_avg_price
  ),
  upd as (
    update public.holdings h set quantity = r.new_quantity, avg_price = r.new_avg_price
    from rec r where h.id = r.holding_id
    returning h.id
  ),
  ins as (
    insert into public.notifications (tenant_id, user_id, type, title, body, data)
    select r.tenant_id, r.user_id, 'holding_adjusted',
           r.symbol || ' had a split or bonus issue',
           'From ' || to_char(r.ex_date, 'DD Mon YYYY') || ' each share became '
             || private.fmt_qty(r.factor) || ' shares. We changed your holding from '
             || private.fmt_qty(r.old_quantity) || ' to '
             || private.fmt_qty(r.new_quantity) || ' shares at an average of ₹'
             || to_char(r.new_avg_price, 'FM999G99G99G990D00')
             || '. The money you put in is the same. If this is wrong, undo it from your portfolio.',
           jsonb_build_object('adjustment_id', r.id, 'symbol', r.symbol)
    from rec r
    where exists (select 1 from upd u where u.id = r.holding_id)
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end $$;
revoke all on function private.apply_corporate_actions() from public, anon, authenticated;

-- Put a holding back as it was before an adjustment. Only the owner, in the active workspace, and only while the holding
-- still has the adjusted numbers (an edit after it is the owner's own correction and wins).
create or replace function public.undo_holding_adjustment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.holding_adjustments;
  v_t uuid := private.active_tenant_id();
begin
  select * into a from public.holding_adjustments x
  where x.id = p_id and x.user_id = auth.uid() and x.tenant_id = v_t and x.undone_at is null;
  if a.id is null or not private.is_tenant_member(v_t) then
    raise exception 'adjustment not found' using errcode = 'P0002';
  end if;
  update public.holdings h set quantity = a.old_quantity, avg_price = a.old_avg_price
  where h.id = a.holding_id and h.user_id = a.user_id and h.tenant_id = a.tenant_id
    and h.quantity = a.new_quantity and h.avg_price = a.new_avg_price;
  if not found then
    raise exception 'holding changed since the adjustment' using errcode = 'P0001';
  end if;
  update public.holding_adjustments set undone_at = now() where id = a.id;
end $$;
revoke all on function public.undo_holding_adjustment(uuid) from public, anon;
grant execute on function public.undo_holding_adjustment(uuid) to authenticated;

-- ------------------------------------------------------------------ 1 + 2. the notifier
-- Same as migration 22 except: split and bonus adjustments run first, and exit messages follow notification_prefs and
-- name the rule.
create or replace function private.run_eod_notifier() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_alerts  integer := 0;
  v_signals integer := 0;
  v_expiry  integer := 0;
  v_adjust  integer := 0;
  v_errors  text[]  := '{}';
begin
  begin
    v_adjust := private.apply_corporate_actions();
  exception when others then
    v_errors := v_errors || ('corporate_actions: ' || sqlerrm);
  end;

  begin
    with latest as (
      select distinct on (c.symbol, c.exchange) c.symbol, c.exchange, c.high, c.low, c.close, c.ts
      from public.market_candles c
      where c.interval = '1d' and c.ts > now() - interval '7 days'
      order by c.symbol, c.exchange, c.ts desc
    ),
    hit as (
      update public.price_alerts a
         set status = 'triggered',
             triggered_at = now(),
             triggered_price = case when a.condition = 'above' then greatest(a.trigger_price, l.close)
                                    else least(a.trigger_price, l.close) end
        from latest l
       where a.status = 'armed'
         and l.symbol = a.symbol and l.exchange = a.exchange
         and l.ts - interval '6 hours 15 minutes' > a.updated_at
         and ((a.condition = 'above' and l.high >= a.trigger_price)
           or (a.condition = 'below' and l.low  <= a.trigger_price))
         and coalesce((select (p.features ->> 'alerts')::boolean from public.plans p
                        where p.code = private.effective_plan(a.user_id, a.tenant_id)), false)
      returning a.id, a.tenant_id, a.user_id, a.symbol, a.condition, a.trigger_price, l.close
    ),
    ins as (
      insert into public.notifications (tenant_id, user_id, type, title, body, data)
      select h.tenant_id, h.user_id, 'price_alert',
             h.symbol || ' crossed ' || case when h.condition = 'above' then 'above ' else 'below ' end
               || '₹' || to_char(h.trigger_price, 'FM999G99G99G990D00'),
             'Closed at ₹' || to_char(h.close, 'FM999G99G99G990D00') || '. The alert is now off; set a new level if you still care.',
             jsonb_build_object('alert_id', h.id, 'symbol', h.symbol)
      from hit h
      returning 1
    )
    select count(*) into v_alerts from ins;
  exception when others then
    v_errors := v_errors || ('price_alerts: ' || sqlerrm);
  end;

  begin
    with recent as (
      select s.id, s.symbol, s.exchange, s.strategy, s.payload ->> 'result' as how,
             private.try_numeric(s.payload ->> 'close') as at
      from public.trading_signals s
      where s.signal_type = 'exit' and s.generated_at > now() - interval '4 days'
    ),
    holders as (
      select distinct h.tenant_id, h.user_id, r.id as signal_id, r.symbol, r.strategy, r.how, r.at
      from recent r
      join public.holdings h on h.symbol = r.symbol and h.exchange = r.exchange and h.quantity > 0
      left join public.notification_prefs p on p.user_id = h.user_id and p.tenant_id = h.tenant_id
      where r.strategy = any (coalesce(p.exit_rules, array['strong_trend', 'sma_trend', 'ma200_trend']))
    ),
    fresh as (
      insert into private.notification_ledger (user_id, tenant_id, kind, ref)
      select x.user_id, x.tenant_id, 'exit_signal', x.signal_id::text from holders x
      on conflict do nothing
      returning user_id, tenant_id, ref
    ),
    ins as (
      insert into public.notifications (tenant_id, user_id, type, title, body, data)
      select x.tenant_id, x.user_id, 'exit_signal',
             private.rule_label(x.strategy) || ' closed its trade in ' || x.symbol,
             case x.how when 'STOP_HIT' then 'Its safety stop was hit'
                        when 'BOUNCE'   then 'It sold on the bounce'
                        when 'TIME'     then 'Its time limit passed'
                        else 'It closed its trade' end
               || coalesce(' at ₹' || to_char(x.at, 'FM999G99G99G990D00'), '')
               || '. This is the rule''s own research trade, not advice. Your holding is unchanged.',
             jsonb_build_object('signal_id', x.signal_id, 'symbol', x.symbol, 'strategy', x.strategy)
      from holders x
      join fresh f on f.user_id = x.user_id and f.tenant_id = x.tenant_id and f.ref = x.signal_id::text
      returning 1
    )
    select count(*) into v_signals from ins;
  exception when others then
    v_errors := v_errors || ('exit_signals: ' || sqlerrm);
  end;

  begin
    with due as (
      select s.tenant_id, s.user_id, s.id, s.status, s.current_period_end
      from public.subscriptions s
      where s.status in ('trialing', 'active')
        and s.current_period_end > now()
        and s.current_period_end <= now() + interval '7 days'
    ),
    fresh as (
      insert into private.notification_ledger (user_id, tenant_id, kind, ref)
      select d.user_id, d.tenant_id, 'plan_expiry', d.id::text || ':' || d.current_period_end::text from due d
      on conflict do nothing
      returning user_id, tenant_id, ref
    ),
    ins as (
      insert into public.notifications (tenant_id, user_id, type, title, body, data)
      select d.tenant_id, d.user_id, 'plan_expiry',
             case when d.status = 'trialing' then 'Your trial ends soon' else 'Your plan ends soon' end,
             'It ends on ' || to_char(d.current_period_end at time zone 'Asia/Kolkata', 'DD Mon YYYY')
               || '. Renew from Plan & billing to keep your radar, alerts and portfolio running.',
             jsonb_build_object('subscription_id', d.id, 'period_end', d.current_period_end)
      from due d
      join fresh f on f.user_id = d.user_id and f.tenant_id = d.tenant_id
                  and f.ref = d.id::text || ':' || d.current_period_end::text
      returning 1
    )
    select count(*) into v_expiry from ins;
  exception when others then
    v_errors := v_errors || ('plan_expiry: ' || sqlerrm);
  end;

  return jsonb_build_object('holding_adjustments', v_adjust, 'price_alerts', v_alerts, 'exit_signals', v_signals,
                            'plan_expiry', v_expiry, 'errors', to_jsonb(v_errors));
end $$;
revoke all on function private.run_eod_notifier() from public, anon, authenticated;
