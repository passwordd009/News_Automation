import { createClient } from "@/lib/supabase/server";
import { explainQueryError } from "@/lib/articles/queries";
import { requestState } from "@/lib/auth/approval";
import type { Profile } from "@/types/database";

export interface UserList {
  users: Profile[];
  error?: string;
}

/**
 * Everyone with an account.
 *
 * Readable by reviewers under `profiles_select_self_or_reviewer`; a Content
 * Creator calling this gets back only themselves, which is why the page is
 * behind manageUserRoles rather than relying on the query to be empty.
 */
export async function getUsers(): Promise<UserList> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    // Only accounts that are actually in. Requests live in their own list
    // above, where they have buttons instead of a role dropdown.
    .eq("access_status", "approved")
    // Admins first, then alphabetically — the people with power are the ones
    // worth seeing at a glance.
    .order("role", { ascending: true })
    .order("email", { ascending: true })
    .returns<Profile[]>();

  if (error) {
    console.error("Could not load users:", error.message);
    return { users: [], error: explainQueryError(error.message) };
  }

  return { users: data ?? [] };
}

export interface SignupRequest {
  id: string;
  email: string | null;
  fullName: string | null;
  requestedAt: string;
}

export interface SignupQueue {
  waiting: SignupRequest[];
  /** Past 72 hours and never answered. Kept, but no longer counted. */
  expired: SignupRequest[];
  error?: string;
}

/**
 * Accounts asking to be let in.
 *
 * Split rather than filtered: a lapsed request is not the same as no request,
 * and an admin who wants to accept a late one has to be able to see it.
 */
export async function getSignupRequests(now = new Date()): Promise<SignupQueue> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, requested_at")
    .eq("access_status", "pending")
    .order("requested_at", { ascending: true })
    .returns<Pick<Profile, "id" | "email" | "full_name" | "requested_at">[]>();

  if (error) {
    console.error("Could not load signup requests:", error.message);
    return { waiting: [], expired: [], error: explainQueryError(error.message) };
  }

  const waiting: SignupRequest[] = [];
  const expired: SignupRequest[] = [];

  for (const row of data ?? []) {
    const request: SignupRequest = {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      requestedAt: row.requested_at,
    };
    (requestState(row.requested_at, now) === "waiting" ? waiting : expired).push(request);
  }

  return { waiting, expired };
}
