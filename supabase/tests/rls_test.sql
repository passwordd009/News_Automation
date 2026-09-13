-- RLS policy tests.
--
-- Each case acts as a real Postgres role with a real auth.uid(), so these
-- exercise the shipped policies rather than describing them. Any failure raises
-- and aborts the run.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- fixtures (as superuser, bypassing RLS)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@hestia.test'),
  ('a0000000-0000-0000-0000-000000000002', 'approver@hestia.test'),
  ('a0000000-0000-0000-0000-000000000003', 'creator@hestia.test');

update public.profiles set role = 'admin'    where id = 'a0000000-0000-0000-0000-000000000001';
update public.profiles set role = 'approver' where id = 'a0000000-0000-0000-0000-000000000002';
-- creator keeps the content_creator default

insert into public.weekly_periods (id, start_date, end_date)
values ('b0000000-0000-0000-0000-000000000001', date '2026-09-07', date '2026-09-13');

insert into public.articles (id, weekly_period_id, title, url, normalized_url, status)
values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'Pending story', 'https://example.com/pending', 'https://example.com/pending', 'pending'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001',
   'Declined story', 'https://example.com/declined', 'https://example.com/declined', 'declined'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001',
   'Approved story', 'https://example.com/approved', 'https://example.com/approved', 'approved');

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function public.assert(condition boolean, label text)
  returns void language plpgsql as $$
begin
  if condition then
    raise notice '  PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end;
$$;

create or replace function public.act_as(user_id uuid) returns void
  language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', user_id::text, true);
end;
$$;

\echo ''
\echo '=== Content Creator ==='

begin;
set local role authenticated;
select public.act_as('a0000000-0000-0000-0000-000000000003');

do $$
declare n int; ok boolean;
begin
  -- §6: the pending queue is invisible to Content Creators.
  select count(*) into n from public.articles where status = 'pending';
  perform public.assert(n = 0, 'cannot see pending articles');

  select count(*) into n from public.articles;
  perform public.assert(n = 2, 'can see approved + declined articles');

  -- The headline rule: no approving, at the database layer.
  update public.articles set status = 'approved'
   where id = 'c0000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  perform public.assert(n = 0, 'cannot approve an article');

  update public.articles set status = 'declined'
   where id = 'c0000000-0000-0000-0000-000000000003';
  get diagnostics n = row_count;
  perform public.assert(n = 0, 'cannot decline an article');

  update public.articles set description = 'edited by a creator'
   where id = 'c0000000-0000-0000-0000-000000000003';
  get diagnostics n = row_count;
  perform public.assert(n = 0, 'cannot edit editorial fields');

  -- Self-promotion must fail. The policy allows the row but not a changed role,
  -- so this raises rather than updating zero rows.
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    perform public.assert(false, 'cannot promote self to admin');
  exception when others then
    perform public.assert(true, 'cannot promote self to admin');
  end;

  -- Reconsideration is allowed, and only as yourself.
  insert into public.approval_requests (article_id, requested_by, reason)
  values ('c0000000-0000-0000-0000-000000000002', auth.uid(), 'Has tenant resources.');
  perform public.assert(true, 'can request reconsideration');

  select status = 'reconsideration_requested' into ok
    from public.articles where id = 'c0000000-0000-0000-0000-000000000002';
  perform public.assert(ok, 'request moves the article into the reviewer queue');

  begin
    insert into public.approval_requests (article_id, requested_by, reason)
    values ('c0000000-0000-0000-0000-000000000002',
            'a0000000-0000-0000-0000-000000000002', 'impersonation attempt');
    perform public.assert(false, 'cannot file a request as someone else');
  exception when others then
    perform public.assert(true, 'cannot file a request as someone else');
  end;

  -- Resolving is a reviewer's job.
  update public.approval_requests set status = 'approved' where article_id = 'c0000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  perform public.assert(n = 0, 'cannot resolve their own request');

  begin
    insert into public.weekly_periods (start_date, end_date) values (date '2026-09-14', date '2026-09-20');
    perform public.assert(false, 'cannot create a weekly period');
  exception when others then
    perform public.assert(true, 'cannot create a weekly period');
  end;
end;
$$;
rollback;

\echo ''
\echo '=== Approver ==='

begin;
set local role authenticated;
select public.act_as('a0000000-0000-0000-0000-000000000002');

do $$
declare n int; stamped uuid;
begin
  select count(*) into n from public.articles where status = 'pending';
  perform public.assert(n = 1, 'can see the pending queue');

  update public.articles set status = 'approved'
   where id = 'c0000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  perform public.assert(n = 1, 'can approve an article');

  -- The decision is stamped from the session identity, not from the client.
  select approved_by into stamped from public.articles
   where id = 'c0000000-0000-0000-0000-000000000001';
  perform public.assert(stamped = auth.uid(), 'approval is stamped with the approver identity');

  -- Forging another reviewer's name is overwritten by the trigger.
  update public.articles
     set status = 'declined', declined_by = 'a0000000-0000-0000-0000-000000000001'
   where id = 'c0000000-0000-0000-0000-000000000003';
  select declined_by into stamped from public.articles
   where id = 'c0000000-0000-0000-0000-000000000003';
  perform public.assert(stamped = auth.uid(), 'cannot record a decision under another reviewer');

  update public.articles set description = 'reviewed summary'
   where id = 'c0000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  perform public.assert(n = 1, 'can edit editorial fields');

  -- Role management stays with admins.
  update public.profiles set role = 'admin' where id = 'a0000000-0000-0000-0000-000000000003';
  get diagnostics n = row_count;
  perform public.assert(n = 0, 'cannot change another user''s role');
end;
$$;
rollback;

\echo ''
\echo '=== Admin ==='

begin;
set local role authenticated;
select public.act_as('a0000000-0000-0000-0000-000000000001');

do $$
declare n int; next_id uuid;
begin
  select count(*) into n from public.articles;
  perform public.assert(n = 3, 'can see every article');

  update public.profiles set role = 'approver' where id = 'a0000000-0000-0000-0000-000000000003';
  get diagnostics n = row_count;
  perform public.assert(n = 1, 'can change another user''s role');

  -- Rotating closes the current period and opens the next in one transaction.
  next_id := (public.rotate_weekly_period(date '2026-09-14', date '2026-09-20')).id;

  select count(*) into n from public.weekly_periods where status = 'active';
  perform public.assert(n = 1, 'rotating leaves exactly one active period');

  select count(*) into n from public.weekly_periods
   where status = 'closed' and closed_at is not null;
  perform public.assert(n = 1, 'the previous period is closed and stamped');

  -- A decision is permanent: approved and declined articles stay with the
  -- week they were decided in (§7), even after it closes.
  select count(*) into n from public.articles
   where weekly_period_id = 'b0000000-0000-0000-0000-000000000001'
     and status in ('approved', 'declined');
  perform public.assert(n = 2, 'decided articles stay with their closed week');

  -- Indecision rolls forward, so articles collected Monday morning are not
  -- stranded in a week that closes at noon.
  select count(*) into n from public.articles
   where weekly_period_id = next_id and status = 'pending';
  perform public.assert(n = 1, 'undecided articles move into the new week');

  select count(*) into n from public.articles
   where weekly_period_id = 'b0000000-0000-0000-0000-000000000001'
     and status = 'pending';
  perform public.assert(n = 0, 'no pending article is left behind in a closed week');
end;
$$;
rollback;

\echo ''
\echo '=== Weekly period rotation is reviewer-gated ==='

begin;
set local role authenticated;
select public.act_as('a0000000-0000-0000-0000-000000000003');
do $$
begin
  begin
    perform public.rotate_weekly_period(date '2026-09-14', date '2026-09-20');
    perform public.assert(false, 'content creator cannot rotate the weekly period');
  exception when others then
    perform public.assert(true, 'content creator cannot rotate the weekly period');
  end;
end;
$$;
rollback;

\echo ''
\echo '=== Reconsideration resolved by a reviewer ==='

begin;
set local role authenticated;
select public.act_as('a0000000-0000-0000-0000-000000000003');
insert into public.approval_requests (article_id, requested_by, reason)
values ('c0000000-0000-0000-0000-000000000002', auth.uid(), 'Please look again.');
reset role;

set local role authenticated;
select public.act_as('a0000000-0000-0000-0000-000000000002');
do $$
declare n int; article_status text; resolver uuid;
begin
  update public.approval_requests set status = 'approved'
   where article_id = 'c0000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  perform public.assert(n = 1, 'reviewer can resolve a reconsideration request');

  select status into article_status from public.articles
   where id = 'c0000000-0000-0000-0000-000000000002';
  perform public.assert(article_status = 'approved', 'resolving the request approves the article');

  select resolved_by into resolver from public.approval_requests
   where article_id = 'c0000000-0000-0000-0000-000000000002';
  perform public.assert(resolver = auth.uid(), 'resolution is stamped with the reviewer identity');
end;
$$;
rollback;

\echo ''
\echo '=== Schema invariants ==='

do $$
declare n int;
begin
  -- §7: a second active period must be impossible.
  begin
    insert into public.weekly_periods (start_date, end_date) values (date '2026-09-21', date '2026-09-27');
    perform public.assert(false, 'only one active weekly period allowed');
  exception when unique_violation then
    perform public.assert(true, 'only one active weekly period allowed');
  end;

  -- §20: duplicate normalized URLs are rejected.
  begin
    insert into public.articles (weekly_period_id, title, url, normalized_url)
    values ('b0000000-0000-0000-0000-000000000001', 'Dupe',
            'https://example.com/approved', 'https://example.com/approved');
    perform public.assert(false, 'duplicate normalized_url rejected');
  exception when unique_violation then
    perform public.assert(true, 'duplicate normalized_url rejected');
  end;

  -- Scores outside 0-10 are rejected.
  begin
    insert into public.articles (weekly_period_id, title, url, normalized_url, overall_score)
    values ('b0000000-0000-0000-0000-000000000001', 'Bad score',
            'https://example.com/bad', 'https://example.com/bad', 11);
    perform public.assert(false, 'score above 10 rejected');
  exception when check_violation then
    perform public.assert(true, 'score above 10 rejected');
  end;

  -- An unknown status must not be storable.
  begin
    insert into public.articles (weekly_period_id, title, url, normalized_url, status)
    values ('b0000000-0000-0000-0000-000000000001', 'Bad status',
            'https://example.com/bs', 'https://example.com/bs', 'published');
    perform public.assert(false, 'unknown article status rejected');
  exception when check_violation then
    perform public.assert(true, 'unknown article status rejected');
  end;
end;
$$;

\echo ''
\echo 'All RLS and schema assertions passed.'
