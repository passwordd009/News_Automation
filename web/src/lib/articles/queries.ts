import { createClient } from "@/lib/supabase/server";
import { dayRange } from "@/lib/week";
import type { Article, WeeklyPeriod } from "@/types/database";

/**
 * Reads for the editorial pages.
 *
 * Every query runs as the signed-in user, so RLS decides what comes back. A
 * Content Creator calling getReviewQueue() receives an empty list rather than
 * an error — the rows simply are not visible to them.
 */

export async function getActivePeriod(): Promise<WeeklyPeriod | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("weekly_periods")
    .select("*")
    .eq("status", "active")
    .maybeSingle<WeeklyPeriod>();
  return data ?? null;
}

export interface ReviewQueue {
  period: WeeklyPeriod | null;
  articles: Article[];
  /**
   * Why the read failed, when it did.
   *
   * A failed query used to return an empty list, which the page rendered as
   * "nothing waiting" — a missing column and a quiet week looked identical,
   * and the real reason went to the server console where nobody was looking.
   * Callers are expected to show this.
   */
  error?: string;
}

/**
 * Articles awaiting a decision, best candidates first.
 *
 * Includes reconsideration requests (§11.4): a declined story someone asked to
 * revisit belongs in the same queue as a fresh one.
 *
 * Everything the worker collected is here, including stories the AI scored
 * poorly — nothing is hidden from reviewers. The ordering does the work:
 * reconsiderations first, then AI-recommended, then by score, so the strongest
 * candidates rise and the weakest sink without being silently dropped.
 */
export async function getReviewQueue(day?: string): Promise<ReviewQueue> {
  const supabase = await createClient();
  const period = await getActivePeriod();

  let query = supabase
    .from("articles")
    .select("*")
    .in("status", ["pending", "reconsideration_requested"]);

  if (day) {
    // effective_date is published_at, or the fetch time when the feed gave
    // none — so an article sits under the day it actually appeared.
    const { start, end } = dayRange(day);
    query = query.gte("effective_date", start).lt("effective_date", end);
  }

  const { data, error } = await query
    .order("status", { ascending: false })
    .order("ai_recommended", { ascending: false })
    .order("overall_score", { ascending: false, nullsFirst: false })
    .order("fetched_at", { ascending: false })
    .returns<Article[]>();

  if (error) {
    console.error("Could not load the review queue:", error.message);
    return { period, articles: [], error: explainQueryError(error.message) };
  }

  return { period, articles: data ?? [] };
}

export interface ApprovedWeek {
  period: WeeklyPeriod | null;
  articles: Article[];
}

/**
 * The approved articles for one editorial week.
 *
 * Defaults to the active period — which, because a week stays active until
 * Monday at noon, is the week being posted right up to the moment it goes out.
 * Pass a period id for an archived week; the page renders both the same way.
 */
export async function getApprovedWeek(periodId?: string): Promise<ApprovedWeek> {
  const supabase = await createClient();

  const period = periodId
    ? await getPeriod(periodId)
    : await getActivePeriod();

  if (!period) return { period: null, articles: [] };

  const { data, error } = await supabase
    .from("articles")
    .select("*")
    .eq("weekly_period_id", period.id)
    .eq("status", "approved")
    .order("approved_at", { ascending: true })
    .returns<Article[]>();

  if (error) {
    console.error("Could not load approved articles:", error.message);
    return { period, articles: [] };
  }

  return { period, articles: data ?? [] };
}

export async function getPeriod(periodId: string): Promise<WeeklyPeriod | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("weekly_periods")
    .select("*")
    .eq("id", periodId)
    .maybeSingle<WeeklyPeriod>();
  return data ?? null;
}

/**
 * Turn a PostgREST error into something a person can act on.
 *
 * The one that actually happens is a migration that has not been applied: the
 * column the day tabs group on does not exist yet, so every day-filtered read
 * fails while the unfiltered ones keep working.
 */
export function explainQueryError(message: string): string {
  if (/effective_date/.test(message)) {
    return (
      "The articles table has no effective_date column, so the day tabs cannot " +
      "read anything. Apply the migration supabase/migrations/" +
      "20260916000001_article_effective_date.sql (supabase db push), then reload."
    );
  }
  if (/permission denied/i.test(message)) {
    return `The database refused the read: ${message}. Check the RLS policies are applied.`;
  }
  return `The database rejected the query: ${message}`;
}

export interface DayCounts {
  /** Everything awaiting a decision, per day. */
  pending: Record<string, number>;
  /** The subset the AI recommended, per day. */
  recommended: Record<string, number>;
  error?: string;
}

/** How many articles are waiting on each day of the week, and how many are recommended. */
export async function getPendingCountsByDay(days: string[]): Promise<DayCounts> {
  const supabase = await createClient();
  if (days.length === 0) return { pending: {}, recommended: {} };

  // One query for the whole span, bucketed here — seven round trips to count
  // seven numbers would be wasteful.
  const { start } = dayRange(days[0]);
  const { end } = dayRange(days[days.length - 1]);

  const { data, error } = await supabase
    .from("articles")
    .select("effective_date, ai_recommended")
    .in("status", ["pending", "reconsideration_requested"])
    .gte("effective_date", start)
    .lt("effective_date", end)
    .returns<{ effective_date: string; ai_recommended: boolean | null }[]>();

  if (error) {
    console.error("Could not count the week:", error.message);
    return { pending: {}, recommended: {}, error: explainQueryError(error.message) };
  }

  const pending: Record<string, number> = {};
  const recommended: Record<string, number> = {};
  for (const day of days) {
    const range = dayRange(day);
    const onDay = (data ?? []).filter(
      (row) => row.effective_date >= range.start && row.effective_date < range.end,
    );
    pending[day] = onDay.length;
    recommended[day] = onDay.filter((row) => row.ai_recommended).length;
  }
  return { pending, recommended };
}
