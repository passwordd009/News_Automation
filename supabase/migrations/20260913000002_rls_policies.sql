-- Row Level Security enforcing the §6 authorization matrix.
--
-- The UI hides buttons; this is what actually stops the action. Every policy
-- here is exercised per role by supabase/tests/rls_test.sql.

-- ---------------------------------------------------------------------------
-- role helpers
--
-- security definer so they can read profiles without recursing through the
-- profiles policies that call them.
-- ---------------------------------------------------------------------------

create or replace function public.current_role_name() returns text
  language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;

-- Admin or approver: the two roles that may make editorial decisions.
create or replace function public.is_reviewer() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() in ('admin', 'approver'), false)
$$;

-- ---------------------------------------------------------------------------
-- grants
--
-- RLS filters rows, but a missing grant blocks the statement before any policy
-- is consulted. Both layers are set explicitly rather than inherited.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select on public.profiles to authenticated;
grant update on public.profiles to authenticated;

grant select on public.weekly_periods to authenticated;
grant insert, update on public.weekly_periods to authenticated;

grant select on public.articles to authenticated;
grant update on public.articles to authenticated;

grant select, insert, update on public.approval_requests to authenticated;

-- Content Creators never get INSERT or DELETE on articles: ingestion is the
-- Python worker's job and runs as service_role, which bypasses RLS.

alter table public.profiles          enable row level security;
alter table public.weekly_periods    enable row level security;
alter table public.articles          enable row level security;
alter table public.approval_requests enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

-- Everyone can read their own profile; reviewers can read all, so the UI can
-- show who approved or declined a story.
create policy profiles_select_self_or_reviewer on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_reviewer());

-- You may edit your own profile but NOT your own role (§17). The new row's role
-- must match the role you already have.
create policy profiles_update_self_not_role on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_role_name());

-- Only an admin manages roles.
create policy profiles_admin_manage on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- weekly_periods
-- ---------------------------------------------------------------------------

create policy weekly_periods_select_all on public.weekly_periods
  for select to authenticated
  using (true);

create policy weekly_periods_admin_insert on public.weekly_periods
  for insert to authenticated
  with check (public.is_admin());

create policy weekly_periods_admin_update on public.weekly_periods
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- articles
-- ---------------------------------------------------------------------------

-- Reviewers see everything, including the pending queue.
create policy articles_select_reviewer on public.articles
  for select to authenticated
  using (public.is_reviewer());

-- Content Creators see decided articles only — never the pending queue (§6).
create policy articles_select_creator on public.articles
  for select to authenticated
  using (
    public.current_role_name() = 'content_creator'
    and status in ('approved', 'declined', 'reconsideration_requested')
  );

-- Only reviewers may approve, decline or edit editorial fields. There is no
-- UPDATE policy for content_creator, so the database refuses the write no
-- matter what the client sends.
create policy articles_update_reviewer on public.articles
  for update to authenticated
  using (public.is_reviewer())
  with check (public.is_reviewer());

create policy articles_delete_admin on public.articles
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- approval_requests
-- ---------------------------------------------------------------------------

-- You can see your own requests; reviewers see all of them.
create policy approval_requests_select on public.approval_requests
  for select to authenticated
  using (requested_by = auth.uid() or public.is_reviewer());

-- You may only file a request as yourself, and only against a declined article.
create policy approval_requests_insert_self on public.approval_requests
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and exists (
      select 1 from public.articles a
       where a.id = article_id
         and a.status in ('declined', 'reconsideration_requested')
    )
  );

-- Only reviewers resolve requests.
create policy approval_requests_resolve_reviewer on public.approval_requests
  for update to authenticated
  using (public.is_reviewer())
  with check (public.is_reviewer());
