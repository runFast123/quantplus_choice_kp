-- Source: quantspulse_supabase_schema.md §5.2 Tenancy
-- =====================================================================
-- 5.2 Tenants, memberships, invitations, platform admins
-- =====================================================================
create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  slug       text unique check (slug ~ '^[a-z0-9-]{3,48}$'),
  type       public.tenant_type not null default 'personal',
  status     text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.tenant_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_idx on public.tenant_members (user_id);

create table public.tenant_invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       text not null check (email = lower(email)),
  role        public.tenant_role not null default 'member' check (role <> 'owner'),
  token_hash  text not null unique,      -- SHA-256 of the emailed token; raw token never stored
  invited_by  uuid references auth.users(id) on delete set null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index tenant_invitations_tenant_idx on public.tenant_invitations (tenant_id);

-- Platform (super) admins. Only writable by direct SQL as the DB owner.
create table private.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note       text
);

-- Membership helpers. SECURITY DEFINER so RLS policies can call them
-- without recursive RLS checks on tenant_members.
create or replace function private.is_tenant_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant
      and m.user_id = (select auth.uid())
      and t.status = 'active'
  )
$$;

create or replace function private.has_tenant_role(p_tenant uuid, p_roles public.tenant_role[])
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
      and t.status = 'active'
  )
$$;

create or replace function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.platform_admins a where a.user_id = (select auth.uid()))
$$;
