-- =====================================================================
-- 5.23 Product change (2026-10-01): broker connections removed.
--      Holdings are entered by hand; market data comes from the EOD
--      pipeline (pipelines/eod). Drops every broker table, secret, RPC,
--      enum, consent purpose and plan feature. See DECISIONS ADR-025.
-- =====================================================================

-- Export no longer mentions brokers (must go before the table is dropped).
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
    'ai_provider_keys',   (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.ai_provider_keys x)
  )
$$;
revoke execute on function public.export_my_data() from public, anon;
grant  execute on function public.export_my_data() to authenticated;

-- Portfolios no longer link to a broker connection.
alter table public.portfolios drop constraint if exists portfolios_broker_connection_id_user_id_tenant_id_fkey;
alter table public.portfolios drop column if exists broker_connection_id;

-- Service bridge + secrets + table.
drop function if exists public.svc_put_broker_credentials(uuid, text, text, text, smallint);
drop function if exists public.svc_get_broker_credentials(uuid);
drop table if exists private.broker_credentials;
drop table if exists public.broker_connections;
drop type if exists public.broker_code;

-- Source of holdings/portfolios: manual entry or file import only.
update public.portfolios set source = 'manual' where source = 'broker';
update public.holdings   set source = 'manual' where source = 'broker';
alter table public.portfolios drop constraint if exists portfolios_source_check;
alter table public.portfolios add  constraint portfolios_source_check check (source in ('manual', 'import'));
alter table public.holdings   drop constraint if exists holdings_source_check;
alter table public.holdings   add  constraint holdings_source_check   check (source in ('manual', 'import'));

-- Consent purpose no longer exists.
delete from public.user_consents where purpose = 'broker_data_access';
alter table public.user_consents drop constraint if exists user_consents_purpose_check;
alter table public.user_consents add constraint user_consents_purpose_check
  check (purpose in ('terms', 'privacy_policy', 'ai_processing', 'marketing'));

-- Plan feature removed from the catalog.
update public.plans set features = features - 'broker_connect';
