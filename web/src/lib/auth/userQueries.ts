import { createClient } from "@/lib/supabase/server";
import { explainQueryError } from "@/lib/articles/queries";
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
