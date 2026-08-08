-- Enough of Supabase to run this repo's migrations on a stock Postgres.
--
-- Used by scripts/schema-check.sh. This is NOT a production artefact and must
-- never be run against the real database: it defines auth.uid() from a GUC so
-- a test can impersonate a user, which is exactly what you don't want anywhere
-- near live data.
--
-- Impersonate with:  set local request.jwt.claim.sub = '<auth user uuid>';

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
-- Supabase's auth.uid() reads the request JWT claim. The shim reads a GUC so a
-- test can impersonate a user with `set local request.jwt.claim.sub`.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$ select string_to_array(name, '/') $$;

do $$ begin
  create publication supabase_realtime;
exception when duplicate_object then null; end $$;

create role authenticated;
create role anon;
create role service_role;

-- Buckets carry more columns in Supabase; only the ones storage.sql writes
-- matter here.
alter table storage.buckets add column if not exists file_size_limit bigint;
alter table storage.objects enable row level security;
