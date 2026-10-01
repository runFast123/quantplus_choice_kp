-- Minimal stand-in for the pieces of a Supabase project the migrations touch,
-- so they can run on plain Postgres (PGlite) without Docker. NOT for production.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role supabase_auth_admin nologin noinherit;
grant anon, authenticated, service_role to postgres;

-- Supabase grants table/function access broadly and relies on RLS.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
create table auth.users (
  id              uuid primary key default gen_random_uuid(),
  email           text unique,
  last_sign_in_at timestamptz,
  created_at      timestamptz not null default now()
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text not null
);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

-- pg_cron stand-in
create schema cron;
create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint
language sql as $$
  insert into cron.job values (p_name, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command;
  select 1::bigint
$$;

create publication supabase_realtime;
