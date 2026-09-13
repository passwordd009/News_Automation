import { createClient } from "@/lib/supabase/server";
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
export async function getReviewQueue(): Promise<ReviewQueue> {
  const supabase = await createClient();
  const period = await getActivePeriod();

  const { data, error } = await supabase
    .from("articles")
    .select("*")
    .in("status", ["pending", "reconsideration_requested"])
    .order("status", { ascending: false })
    .order("ai_recommended", { ascending: false })
    .order("overall_score", { ascending: false, nullsFirst: false })
    .order("fetched_at", { ascending: false })
    .returns<Article[]>();

  if (error) {
    console.error("Could not load the review queue:", error.message);
    return { period, articles: [] };
  }

  return { period, articles: data ?? [] };
}
