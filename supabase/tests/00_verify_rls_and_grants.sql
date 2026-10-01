-- Source: quantspulse_supabase_schema.md §5.14 Final Verification
-- Must return ZERO rows: every public table has RLS enabled.
select c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and not c.relrowsecurity;

-- Must return ZERO rows: anon has no table privileges except plans.
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and table_name <> 'plans';
