-- Rotation carries undecided articles into the new week.
--
-- Hestia posts Monday morning covering the week just ended, so a period stays
-- active until Monday noon. That leaves a window — Monday 00:00 to 12:00 —
-- where the worker files fresh articles against a period that is about to
-- close. Without this they would be stranded in a closed week: pending forever,
-- and surfacing under the wrong dates if later approved.
--
-- The rule: a decision is permanent, indecision rolls forward.
--
--   pending                    -> moves to the new period
--   approved / declined /      -> stay with the week they were decided in,
--   reconsideration_requested     as §7 requires

create or replace function public.rotate_weekly_period(p_start date, p_end date)
  returns public.weekly_periods
  language plpgsql set search_path = public as $$
declare
  closing_id  uuid;
  next_period public.weekly_periods;
  moved       integer;
begin
  select id into closing_id from public.weekly_periods where status = 'active';

  update public.weekly_periods
     set status = 'closed', closed_at = now()
   where status = 'active';

  insert into public.weekly_periods (start_date, end_date, status)
  values (p_start, p_end, 'active')
  returning * into next_period;

  if closing_id is not null then
    update public.articles
       set weekly_period_id = next_period.id
     where weekly_period_id = closing_id
       and status = 'pending';

    get diagnostics moved = row_count;
    if moved > 0 then
      raise notice 'Moved % undecided article(s) into the new period.', moved;
    end if;
  end if;

  return next_period;
end;
$$;

comment on function public.rotate_weekly_period(date, date) is
  'Closes the active period and opens the next in one transaction, carrying '
  'still-pending articles forward. Decided articles stay with their week.';
