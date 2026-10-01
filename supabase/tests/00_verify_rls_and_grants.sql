-- Source: quantspulse_supabase_schema.md §5.14 Final Verification — as assertions,
-- so a violation fails the run instead of returning rows nobody reads.
do $$
declare v text;
begin
  -- Every public table has RLS enabled.
  select string_agg(c.relname, ', ') into v
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v is not null then raise exception 'FAIL [verify]: RLS disabled on %', v; end if;

  -- anon has no table privileges except on plans.
  select string_agg(distinct table_name, ', ') into v
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public' and table_name <> 'plans';
  if v is not null then raise exception 'FAIL [verify]: anon has grants on %', v; end if;

  -- Clients never hold TRUNCATE/REFERENCES/TRIGGER (TRUNCATE bypasses RLS).
  select string_agg(distinct table_name || ':' || grantee || ':' || privilege_type, ', ') into v
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
    and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');
  if v is not null then raise exception 'FAIL [verify]: dangerous grants %', v; end if;

  -- Every user-facing view runs with the caller's rights.
  select string_agg(c.relname, ', ') into v
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and not coalesce(c.reloptions @> array['security_invoker=true'], false);
  if v is not null then raise exception 'FAIL [verify]: views without security_invoker: %', v; end if;

  raise notice 'VERIFY PASSED';
end $$;
