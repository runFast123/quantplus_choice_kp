-- Paid features (migration 60): Pro and Pro Plus carry head_start and behaviour_mirror, Basic does not, and the
-- existing features are kept. Rolled back.
begin;

do $$
declare
  f jsonb;
begin
  for f in select features from public.plans where code in ('pro', 'pro_plus') loop
    if not (f ? 'head_start' and f ? 'behaviour_mirror') then raise exception 'FAIL [pro plans carry the new keys]'; end if;
    if not (f ? 'portfolio' and f ? 'alerts' and f ? 'ai_byok') then raise exception 'FAIL [pro plans keep their features]'; end if;
  end loop;
  raise notice 'PASS [pro plans carry the new keys and keep their features]';
  select features into f from public.plans where code = 'basic';
  if f ? 'head_start' or f ? 'behaviour_mirror' then raise exception 'FAIL [basic has no new keys]'; end if;
  raise notice 'PASS [basic has no new keys]';
end $$;

do $$ begin raise notice 'PAID FEATURE TESTS PASSED'; end $$;
rollback;
