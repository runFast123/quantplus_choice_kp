-- Browser push for in-app notifications (Web Push with VAPID; no third-party account).
-- A browser the user turned alerts on in is one push_subscriptions row. The sender
-- (web/src/server/privileged/push.ts) claims undelivered notifications in batches and pushes
-- them to the owner's browsers. Payloads are encrypted end-to-end by the Web Push protocol.

create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default private.active_tenant_id()
                    references public.tenants(id) on delete cascade,
  user_id         uuid not null default auth.uid()
                    references auth.users(id) on delete cascade,
  endpoint        text not null check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh          text not null check (length(p256dh) between 40 and 200),
  auth            text not null check (length(auth) between 10 and 60),
  user_agent      text check (length(user_agent) <= 300),
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  failures        integer not null default 0,
  unique (user_id, tenant_id, endpoint)
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Own rows only (same rule as other user data), no plan gate: alerts, exit signals and stance
-- changes reach every plan. Rows are created and removed, never edited, by the client.
alter table public.push_subscriptions enable row level security;
do $$
declare
  own text := '(user_id = (select auth.uid())'
           || ' and tenant_id = (select private.active_tenant_id())'
           || ' and (select private.is_tenant_member(private.active_tenant_id())))';
begin
  execute format('create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated using %s', own);
  execute format('create policy push_subscriptions_insert_own on public.push_subscriptions for insert to authenticated with check %s', own);
  execute format('create policy push_subscriptions_delete_own on public.push_subscriptions for delete to authenticated using %s', own);
end $$;
revoke all on public.push_subscriptions from anon;
revoke update, truncate on public.push_subscriptions from authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;

-- Delivery marker: set when the sender has handled a notification (pushed, or nobody to push to).
alter table public.notifications add column pushed_at timestamptz;
update public.notifications set pushed_at = created_at where pushed_at is null; -- no backlog on day one
create index notifications_push_pending_idx on public.notifications (created_at) where pushed_at is null;

-- Claim up to p_limit undelivered notifications from the last two days. SKIP LOCKED lets two
-- overlapping senders (cron + pipeline) split the work instead of sending twice.
create or replace function public.svc_claim_push_batch(p_limit integer default 200)
returns table (notification_id uuid, user_id uuid, type text, title text, body text, data jsonb, created_at timestamptz)
language sql security definer set search_path = '' as $$
  with picked as (
    select n.id
    from public.notifications n
    where n.pushed_at is null and n.created_at > now() - interval '2 days'
    order by n.created_at
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
    for update skip locked
  )
  update public.notifications n
  set pushed_at = now()
  from picked
  where n.id = picked.id
  returning n.id, n.user_id, n.type, n.title, n.body, n.data, n.created_at
$$;
revoke execute on function public.svc_claim_push_batch(integer) from public, anon, authenticated;
grant execute on function public.svc_claim_push_batch(integer) to service_role;

-- Data rights: the export includes the browsers a user turned alerts on in.
create or replace function public.export_my_data() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'exported_at',        now(),
    'profile',            (select to_jsonb(p) from public.profiles p),
    'consents',           (select coalesce(jsonb_agg(c), '[]'::jsonb) from public.user_consents c),
    'portfolios',         (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.portfolios x),
    'holdings',           (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.holdings x),
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
