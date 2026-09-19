-- New accounts wait for an admin.
--
-- Until now, signing up was the same thing as being let in: handle_new_user()
-- created a profile with the default role 'content_creator', which can read
-- every approved and declined article. Anyone who found the URL had the
-- newsroom's editorial queue.
--
-- A signup is now a *request*. It appears on the Users page, an admin accepts
-- or declines it, and after 72 hours an unanswered request stops counting as
-- waiting. The row is kept either way: who asked and was never let in is worth
-- knowing, and an admin can still accept late if they choose.
--
-- Expiry is derived from requested_at rather than written by a scheduled job.
-- A clock that has to run for the rule to hold is a clock that can stop; this
-- way the deadline is simply true.

-- ---------------------------------------------------------------------------
-- columns, and the backfill that must come with them
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'access_status'
  ) then
    alter table public.profiles
      add column access_status text not null default 'pending'
        check (access_status in ('pending', 'approved', 'declined')),
      add column requested_at timestamptz not null default now(),
      add column access_decided_by uuid references public.profiles(id) on delete set null,
      add column access_decided_at timestamptz;

    -- Everyone who already has an account keeps it. Without this the column's
    -- default marks every existing profile — including the only admin's — as
    -- waiting for an approval nobody is left with the power to give.
    --
    -- Guarded by the column check above so re-running the migration cannot
    -- approve the people who are genuinely waiting.
    update public.profiles
       set access_status = 'approved',
           access_decided_at = now();
  end if;
end;
$$;

create index if not exists profiles_access_status_idx
  on public.profiles (access_status, requested_at desc);

-- ---------------------------------------------------------------------------
-- the gate
-- ---------------------------------------------------------------------------

-- Every articles policy is keyed on current_role_name(), directly or through
-- is_admin()/is_reviewer(). Making this one function return NULL for an
-- unapproved profile closes all of them at once, which is the point: a gate
-- spread across six policies is a gate with five chances to be missed.
--
-- `role = NULL` is NULL, never true, so a policy comparing against it denies.
create or replace function public.current_role_name() returns text
  language sql stable security definer set search_path = public as $$
  select role from public.profiles
   where id = auth.uid()
     and access_status = 'approved'
$$;

-- Readable without being approved, so the waiting screen can say what it is
-- waiting for.
create or replace function public.current_access_status() returns text
  language sql stable security definer set search_path = public as $$
  select access_status from public.profiles where id = auth.uid()
$$;

-- Nobody edits their own access, approved or not. A pending profile is already
-- blocked by the NULL role above; this says so directly rather than relying on
-- that side effect, which a later change to the role policy could remove.
drop policy if exists profiles_update_self_not_role on public.profiles;
create policy profiles_update_self_not_role on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = public.current_role_name()
    and access_status = public.current_access_status()
  );
