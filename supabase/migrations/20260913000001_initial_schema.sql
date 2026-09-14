-- Project Hestia editorial CMS — core schema.
--
-- Four tables per §10–12 of the CMS spec: profiles, weekly_periods, articles,
-- approval_requests. RLS policies live in the next migration.

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one per auth user, carrying the editorial role
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'content_creator'
              check (role in ('admin', 'approver', 'content_creator')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- A profile is created automatically on signup. Role is never taken from the
-- client: everyone starts as content_creator and is promoted deliberately.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- weekly_periods — the editorial week an article belongs to
-- ---------------------------------------------------------------------------

create table if not exists public.weekly_periods (
  id          uuid primary key default gen_random_uuid(),
  start_date  date not null,
  end_date    date not null,
  status      text not null default 'active' check (status in ('active', 'closed')),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,
  constraint weekly_periods_range_valid check (end_date >= start_date),
  -- A closed period must record when, and an active one must not.
  constraint weekly_periods_closed_at_consistent check (
    (status = 'closed' and closed_at is not null) or
    (status = 'active' and closed_at is null)
  )
);

-- §7: only one period is active at a time. Enforced, not merely intended.
create unique index if not exists weekly_periods_single_active
  on public.weekly_periods ((status)) where status = 'active';

create index if not exists weekly_periods_start_date_idx
  on public.weekly_periods (start_date desc);

-- §7 describes closing the current period and opening the next as one
-- operation. Doing it in a single transaction is what keeps the
-- "only one active period" index satisfiable — inserting first always fails.
-- Runs as the caller, so the RLS policies on weekly_periods still apply.
create or replace function public.rotate_weekly_period(p_start date, p_end date)
  returns public.weekly_periods
  language plpgsql set search_path = public as $$
declare
  next_period public.weekly_periods;
begin
  update public.weekly_periods
     set status = 'closed', closed_at = now()
   where status = 'active';

  insert into public.weekly_periods (start_date, end_date, status)
  values (p_start, p_end, 'active')
  returning * into next_period;

  return next_period;
end;
$$;

-- ---------------------------------------------------------------------------
-- articles
-- ---------------------------------------------------------------------------

create table if not exists public.articles (
  id                    uuid primary key default gen_random_uuid(),
  weekly_period_id      uuid not null references public.weekly_periods(id) on delete restrict,

  -- source data
  title                 text not null,
  url                   text not null,
  normalized_url        text not null,
  source                text,
  source_type           text default 'rss' check (source_type in ('rss', 'gmail', 'news_api', 'manual')),
  published_at          timestamptz,
  fetched_at            timestamptz not null default now(),
  raw_description       text,
  article_text          text,

  -- AI / editorial data
  topic                 text,
  borough               text,
  description           text,
  why_post              text,

  nyc_relevance_score   numeric(4, 2) check (nyc_relevance_score between 0 and 10),
  informative_score     numeric(4, 2) check (informative_score between 0 and 10),
  community_value_score numeric(4, 2) check (community_value_score between 0 and 10),
  positivity_score      numeric(4, 2) check (positivity_score between 0 and 10),
  local_event_score     numeric(4, 2) check (local_event_score between 0 and 10),
  credibility_score     numeric(4, 2) check (credibility_score between 0 and 10),
  overall_score         numeric(4, 2) check (overall_score between 0 and 10),

  -- The AI recommends; it never approves. See §18 and product rule 14.
  ai_recommended        boolean not null default false,
  ai_rejection_reason   text,

  -- workflow
  status                text not null default 'pending'
                        check (status in ('pending', 'approved', 'declined', 'reconsideration_requested')),

  approved_by           uuid references public.profiles(id) on delete set null,
  approved_at           timestamptz,

  declined_by           uuid references public.profiles(id) on delete set null,
  declined_at           timestamptz,
  decline_reason        text,
  delete_after          timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- §20: reject exact duplicate URLs once normalized.
create unique index if not exists articles_normalized_url_key
  on public.articles (normalized_url);

create index if not exists articles_weekly_period_idx on public.articles (weekly_period_id);
create index if not exists articles_status_idx on public.articles (status);
create index if not exists articles_created_at_idx on public.articles (created_at desc);
create index if not exists articles_period_status_idx on public.articles (weekly_period_id, status);
create index if not exists articles_delete_after_idx
  on public.articles (delete_after) where delete_after is not null;

drop trigger if exists articles_touch_updated_at on public.articles;
create trigger articles_touch_updated_at
  before update on public.articles
  for each row execute function public.touch_updated_at();

-- The audit columns are stamped from the session's own identity, so one
-- reviewer cannot record a decision under another reviewer's name.
create or replace function public.stamp_article_decision() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      new.approved_by  = coalesce(auth.uid(), new.approved_by);
      new.approved_at  = now();
      new.declined_by  = null;
      new.declined_at  = null;
      new.delete_after = null;
    elsif new.status = 'declined' then
      new.declined_by  = coalesce(auth.uid(), new.declined_by);
      new.declined_at  = now();
      new.approved_by  = null;
      new.approved_at  = null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists articles_stamp_decision on public.articles;
create trigger articles_stamp_decision
  before update on public.articles
  for each row execute function public.stamp_article_decision();

-- ---------------------------------------------------------------------------
-- approval_requests — reconsideration, kept separate so the original decline
-- decision is never overwritten (§11)
-- ---------------------------------------------------------------------------

create table if not exists public.approval_requests (
  id              uuid primary key default gen_random_uuid(),
  article_id      uuid not null references public.articles(id) on delete cascade,
  requested_by    uuid not null references public.profiles(id) on delete cascade,
  reason          text,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles(id) on delete set null,
  resolution_note text
);

create index if not exists approval_requests_article_idx on public.approval_requests (article_id);
create index if not exists approval_requests_status_idx on public.approval_requests (status);

-- §14: no duplicate pending requests for the same article from the same person.
create unique index if not exists approval_requests_one_pending_per_user
  on public.approval_requests (article_id, requested_by) where status = 'pending';

-- Filing a request moves the article into the reviewers' queue. Doing this in a
-- trigger means a Content Creator never needs UPDATE rights on articles.
create or replace function public.handle_approval_request() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  update public.articles
     set status = 'reconsideration_requested'
   where id = new.article_id
     and status = 'declined';
  return new;
end;
$$;

drop trigger if exists approval_requests_flag_article on public.approval_requests;
create trigger approval_requests_flag_article
  after insert on public.approval_requests
  for each row execute function public.handle_approval_request();

-- Resolving a request settles the article: approved, or back to declined.
create or replace function public.handle_approval_resolution() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    new.resolved_at = now();
    new.resolved_by = coalesce(auth.uid(), new.resolved_by);

    update public.articles
       set status = case when new.status = 'approved' then 'approved' else 'declined' end
     where id = new.article_id;
  end if;
  return new;
end;
$$;

drop trigger if exists approval_requests_resolve on public.approval_requests;
create trigger approval_requests_resolve
  before update on public.approval_requests
  for each row execute function public.handle_approval_resolution();
