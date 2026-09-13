-- Promote the first admin.
--
-- Run this ONCE, by hand, after signing up through the app. Deliberately not a
-- migration: "whoever signs up first becomes admin" is a race, and a hardcoded
-- email in version control is worse.
--
--   1. Sign up through the app with your real email.
--   2. Replace the address below.
--   3. Run it in the Supabase SQL editor, or:
--      psql "$SUPABASE_DB_URL" -f supabase/seed_admin.sql

\set admin_email 'you@example.com'

update public.profiles
   set role = 'admin'
 where id = (select id from auth.users where email = :'admin_email');

-- Fail loudly rather than silently doing nothing if the email does not match.
do $$
declare n int;
begin
  select count(*) into n from public.profiles where role = 'admin';
  if n = 0 then
    raise exception 'No admin was set. Check that the email matches a signed-up user.';
  end if;
  raise notice 'Admin count: %', n;
end;
$$;

-- Open the first editorial week if none exists yet. Adjust the dates to your
-- Sunday-Saturday boundary.
insert into public.weekly_periods (start_date, end_date, status)
select date_trunc('week', current_date)::date - 1,
       date_trunc('week', current_date)::date + 5,
       'active'
where not exists (select 1 from public.weekly_periods where status = 'active');
