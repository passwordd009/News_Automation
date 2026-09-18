-- Returning a decided article to the review queue.
--
-- stamp_article_decision() handled 'approved' and 'declined' but said nothing
-- about a move back to 'pending'. An article sent back would have kept its
-- approved_by and approved_at, so the queue would show a story that still
-- claimed to have been approved by someone — an audit trail asserting a
-- decision that had been withdrawn.
--
-- Clearing both sets on the way back to pending is the whole change. The
-- function is otherwise identical; it is restated in full because
-- `create or replace` has no patch form.

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
    elsif new.status in ('pending', 'reconsideration_requested') then
      -- Back in the queue: no decision stands, so no decision is recorded.
      new.approved_by  = null;
      new.approved_at  = null;
      new.declined_by  = null;
      new.declined_at  = null;
      new.delete_after = null;
      new.decline_reason = null;
    end if;
  end if;
  return new;
end;
$$;

-- Counting approved articles per week, for the archive's month listing.
create index if not exists articles_period_status_idx
  on public.articles (weekly_period_id, status);
