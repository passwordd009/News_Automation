-- Promote the first admin.
--
-- Run this ONCE, after signing up through the app.
--
--   1. Sign up with your real email.
--   2. Change the address on the ADMIN EMAIL line below.
--   3. Run the whole file — paste it into the Supabase SQL editor, or:
--      psql "$SUPABASE_DB_URL" -f supabase/seed_admin.sql
--
-- Deliberately not a migration: "whoever signs up first becomes admin" is a
-- race, and a hardcoded email in version control is worse.
--
-- Plain SQL only, no psql backslash commands, so it runs in the Supabase SQL
-- editor as well as in psql.

do $$
declare
  -- ADMIN EMAIL — change this to yours, then run the file.
  admin_email text := 'you@example.com';

  target_user uuid;
  admin_count integer;
begin
  -- No "did you edit the placeholder?" check: it would have to compare against
  -- the placeholder literal, and a find-and-replace of you@example.com — which
  -- is how people actually edit this — changes both sides and trips it. If the
  -- address was not edited, the lookup below fails and names it.

  select id into target_user
    from auth.users
   where lower(email) = lower(trim(admin_email));

  if target_user is null then
    raise exception
      'No account found for %. Sign up through the app first, then re-run this.',
      admin_email;
  end if;

  update public.profiles set role = 'admin' where id = target_user;

  if not found then
    raise exception
      'User % exists but has no profile row. Apply the migrations first '
      '(supabase db push), which attaches the signup trigger and backfills.',
      admin_email;
  end if;

  select count(*) into admin_count from public.profiles where role = 'admin';
  raise notice 'Promoted % to admin. Total admins: %.', admin_email, admin_count;
end;
$$;

-- Open the first editorial week if none exists.
--
-- Hestia posts each Monday covering the week just ended, so periods run Monday
-- through Sunday. date_trunc('week', ...) already returns the ISO Monday.
insert into public.weekly_periods (start_date, end_date, status)
select date_trunc('week', current_date)::date,
       date_trunc('week', current_date)::date + 6,
       'active'
where not exists (select 1 from public.weekly_periods where status = 'active');

-- Confirm the result.
select p.email,
       p.role,
       (select count(*) from public.weekly_periods where status = 'active') as active_weeks
  from public.profiles p
 where p.role = 'admin';
