"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/getCurrentProfile";
import { isValidRole, type Role } from "@/lib/auth/permissions";
import { joinName } from "@/lib/auth/name";

export interface RoleResult {
  ok: boolean;
  error?: string;
}

/**
 * Change someone's role.
 *
 * RLS is the real gate — `profiles_admin_manage` is the only policy that
 * permits updating another row, and `profiles_update_self_not_role` explicitly
 * forbids changing your own role even as yourself. The checks here produce a
 * readable message instead of a silent zero-row update.
 */
export async function setUserRole(userId: string, role: string): Promise<RoleResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "You are not signed in." };
  if (profile.role !== "admin") {
    return { ok: false, error: "Only an admin can change roles." };
  }
  if (!isValidRole(role)) return { ok: false, error: "That is not a role." };

  // Locking yourself out is easy to do and awkward to undo — it needs another
  // admin, or SQL. The database would allow it; this is the guard that matters.
  if (userId === profile.id) {
    return {
      ok: false,
      error: "You cannot change your own role. Ask another admin, or use seed_admin.sql.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ role: role as Role })
    .eq("id", userId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "That account could not be updated." };

  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * Set your own name.
 *
 * `profiles_update_self_not_role` is the policy doing the work: it permits
 * updating your own row while its WITH CHECK forbids the role changing, so
 * this cannot be turned into a promotion by a crafted request. The RLS suite
 * asserts both halves.
 */
export async function updateMyName(
  firstName: string,
  lastName: string,
): Promise<RoleResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "You are not signed in." };

  const fullName = joinName(firstName, lastName);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", profile.id)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Your profile could not be updated." };

  revalidatePath("/account");
  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * Let an account in, or turn it away.
 *
 * `profiles_admin_manage` is the policy doing the work — it is the only one
 * permitting an update to someone else's row. The checks here turn a silent
 * zero-row update into a message.
 *
 * A lapsed request can still be accepted. Expiry means nobody answered in
 * time, not that the answer was no, and an admin who wants to say yes late
 * should not have to ask the person to sign up again.
 */
export async function decideAccess(
  userId: string,
  decision: "approved" | "declined",
): Promise<RoleResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "You are not signed in." };
  if (profile.role !== "admin") {
    return { ok: false, error: "Only an admin can approve accounts." };
  }
  if (userId === profile.id) {
    return { ok: false, error: "You cannot decide on your own account." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({
      access_status: decision,
      // approved_by/at are stamped here rather than by a trigger because there
      // is no equivalent of auth.uid() protection to gain: the only writer is
      // an admin, and the policy already proved that.
      access_decided_by: profile.id,
      access_decided_at: new Date().toISOString(),
    })
    .eq("id", userId)
    // Only an untouched request. Two admins clicking at once should not have
    // the second silently overwrite the first's decision.
    .eq("access_status", "pending")
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    return { ok: false, error: "That request was already decided by someone else." };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}
