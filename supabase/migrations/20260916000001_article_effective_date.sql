-- One column to group an article by "the day it was posted".
--
-- The review queue is organised by day of the editorial week, so it needs a
-- single date to filter on. published_at is the right answer when the feed
-- gives one, but plenty of RSS entries have no date at all — those fall back to
-- when we fetched them, which is the closest thing we know.
--
-- Generated and stored rather than computed per query, so it can be indexed and
-- so every reader agrees on the answer.

alter table public.articles
  add column if not exists effective_date timestamptz
  generated always as (coalesce(published_at, fetched_at)) stored;

create index if not exists articles_effective_date_idx
  on public.articles (effective_date desc);

-- The queue filters by day *and* status together.
create index if not exists articles_status_effective_date_idx
  on public.articles (status, effective_date desc);

comment on column public.articles.effective_date is
  'When the article is considered to have appeared: its publication time, or '
  'the fetch time when the feed gave none. Groups articles into days of the '
  'editorial week.';

-- Grant DELETE so the admin-only policy can actually be reached.
--
-- BUG FIX. The RLS migration created articles_delete_admin but never granted
-- DELETE to `authenticated`. A grant is checked before any policy, so the
-- statement failed with "permission denied for table articles" for everyone —
-- the policy was unreachable. Exactly the trap that migration's own comment
-- warns about.
--
-- The grant opens the statement; articles_delete_admin still restricts it to
-- admins, and an approver's delete removes zero rows.
grant delete on public.articles to authenticated;
