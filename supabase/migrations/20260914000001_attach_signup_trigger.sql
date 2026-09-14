-- Attach the signup trigger to auth.users.
--
-- BUG FIX. The initial migration defined public.handle_new_user() but never
-- attached it to anything, so signing up created an auth.users row and no
-- matching profiles row. Without a profile there is no role, the dashboard
-- treats the account as unusable, and the user is bounced straight back out.
--
-- The RLS test suite did not catch this because the harness created the
-- trigger itself — it supplied the very thing production was missing. The
-- harness no longer does that, so this migration is now what the tests
-- exercise.

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who already signed up while the trigger was missing.
insert into public.profiles (id, email, full_name)
select u.id,
       u.email,
       u.raw_user_meta_data ->> 'full_name'
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null
on conflict (id) do nothing;

do $$
declare
  users_without_profiles integer;
begin
  select count(*) into users_without_profiles
    from auth.users u
    left join public.profiles p on p.id = u.id
   where p.id is null;

  if users_without_profiles > 0 then
    raise exception 'Backfill failed: % user(s) still have no profile.', users_without_profiles;
  end if;

  raise notice 'Signup trigger attached. Every auth user now has a profile.';
end;
$$;
