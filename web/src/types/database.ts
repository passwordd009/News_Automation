/**
 * Row shapes for the tables in supabase/migrations/.
 *
 * Hand-written rather than generated so the repo has no dependency on the
 * Supabase CLI being installed. If these drift from the migrations, the
 * migrations win — they are the source of truth.
 */

import type { Role } from "@/lib/auth/permissions";

export type ArticleStatus =
  | "pending"
  | "approved"
  | "declined"
  | "reconsideration_requested";

export type PeriodStatus = "active" | "closed";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  created_at: string;
  updated_at: string;
}

export interface WeeklyPeriod {
  id: string;
  start_date: string;
  end_date: string;
  status: PeriodStatus;
  created_at: string;
  closed_at: string | null;
}

export interface Article {
  id: string;
  weekly_period_id: string;

  title: string;
  url: string;
  normalized_url: string;
  title_fingerprint: string | null;
  source: string | null;
  source_type: string | null;
  published_at: string | null;
  fetched_at: string;
  raw_description: string | null;
  article_text: string | null;

  topic: string | null;
  borough: string | null;
  description: string | null;
  why_post: string | null;

  nyc_relevance_score: number | null;
  informative_score: number | null;
  community_value_score: number | null;
  positivity_score: number | null;
  local_event_score: number | null;
  credibility_score: number | null;
  overall_score: number | null;

  /** The AI's recommendation. Never an approval — that is `status`. */
  ai_recommended: boolean;
  ai_rejection_reason: string | null;

  status: ArticleStatus;

  approved_by: string | null;
  approved_at: string | null;
  declined_by: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  delete_after: string | null;

  created_at: string;
  updated_at: string;
}

export interface ApprovalRequest {
  id: string;
  article_id: string;
  requested_by: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}
