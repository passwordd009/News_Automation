-- One-off correction for an active period created before the Monday-Sunday
-- boundary was confirmed.
--
-- The first version of seed_admin.sql opened a Sunday-Saturday period. Hestia
-- posts on Monday covering the week just ended, so periods run Monday through
-- Sunday. Run this only if your active period starts on a Sunday.
--
--   psql "$SUPABASE_DB_URL" -f supabase/fix_week_boundary.sql

do $$
declare
  period       public.weekly_periods;
  correct_start date := date_trunc('week', current_date)::date;
begin
  select * into period from public.weekly_periods where status = 'active';

  if period.id is null then
    raise notice 'No active period. Nothing to correct.';
    return;
  end if;

  if extract(isodow from period.start_date) = 1 then
    raise notice 'Active period already starts on a Monday (% to %). No change.',
      period.start_date, period.end_date;
    return;
  end if;

  update public.weekly_periods
     set start_date = correct_start,
         end_date   = correct_start + 6
   where id = period.id;

  raise notice 'Corrected the active period from % - % to % - %.',
    period.start_date, period.end_date, correct_start, correct_start + 6;
end;
$$;

select start_date, end_date,
       to_char(start_date, 'Dy') as starts_on,
       to_char(end_date, 'Dy')   as ends_on,
       status
  from public.weekly_periods
 order by start_date desc;
