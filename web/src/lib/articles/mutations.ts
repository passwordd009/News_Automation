"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/getCurrentProfile";
import { can } from "@/lib/auth/permissions";
import { dayRange } from "@/lib/week";

/**
 * Editorial decisions.
 *
 * These run as the signed-in user, so RLS is the real gate: a Content Creator
 * calling approveArticle() directly updates zero rows. The capability check
 * here is a courtesy — it produces a clear message instead of a silent no-op —
 * and is deliberately not the thing being relied on.
 *
 * approved_by / approved_at are NOT set here. A database trigger stamps them
 * from auth.uid(), so a decision cannot be recorded under someone else's name
 * even by a crafted request.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function approveArticle(articleId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "You are not signed in." };
  if (!can(profile.role, "approveArticle")) {
    return { ok: false, error: "Your role cannot approve articles." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("articles")
    .update({ status: "approved" })
    .eq("id", articleId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    // RLS refused it, or someone else already decided this one.
    return { ok: false, error: "That article could not be updated." };
  }

  revalidatePath("/review");
  revalidatePath("/approved");
  return { ok: true };
}

export async function declineArticle(
  articleId: string,
  reason?: string,
): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "You are not signed in." };
  if (!can(profile.role, "declineArticle")) {
    return { ok: false, error: "Your role cannot decline articles." };
  }

  const trimmed = reason?.trim();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("articles")
    .update({
      status: "declined",
      decline_reason: trimmed || null,
      // §9: declined stories stay visible for the rest of the editorial period
      // so a Content Creator has a real chance to ask for reconsideration.
      delete_after: deleteAfter(),
    })
    .eq("id", articleId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "That article could not be updated." };

  revalidatePath("/review");
  revalidatePath("/declined");
  return { ok: true };
}

/** Retention window for declined articles. Configurable, not baked in (§9). */
function deleteAfter(): string {
  const days = Number(process.env.DECLINED_RETENTION_DAYS ?? 21);
  const when = new Date();
  when.setUTCDate(when.getUTCDate() + (Number.isFinite(days) ? days : 21));
  return when.toISOString();
}


/**
 * Permanently delete the undecided articles for one day.
 *
 * This is a real delete, not a decline — the rows are gone and cannot be
 * recovered or reconsidered. It exists to empty a day of noise you never want
 * to look at again.
 *
 * Deliberately limited to `pending`. An approved or declined article is a
 * decision someone made, and a "clear this day" button should not quietly
 * throw those away; they stay, and stay auditable.
 *
 * Only an admin can do this: the `articles_delete_admin` RLS policy is the
 * enforcement, and this check just turns a silent no-op into a clear message.
 */
export async function clearDay(day: string): Promise<ActionResult & { deleted?: number }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "You are not signed in." };
  if (profile.role !== "admin") {
    return { ok: false, error: "Only an admin can delete articles." };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { ok: false, error: "Invalid day." };
  }

  const { start, end } = dayRange(day);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("articles")
    .delete()
    .eq("status", "pending")
    .gte("effective_date", start)
    .lt("effective_date", end)
    .select("id");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/review");
  return { ok: true, deleted: data?.length ?? 0 };
}
