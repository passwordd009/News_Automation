-- LOCAL TEST ONLY — never applied to Supabase.
--
-- Supabase provides the auth schema, auth.uid() and the anon / authenticated /
-- service_role roles. Plain Postgres does not, so this recreates just enough of
-- them to run the real migrations and exercise the policies locally.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  -- The Python worker connects as this; it bypasses RLS exactly as on Supabase.
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- Mirrors Supabase's own implementation: prefers the individual claim setting,
-- falls back to the full claims JSON.
create or replace function auth.uid() returns uuid
  language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
