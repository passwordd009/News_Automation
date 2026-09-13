import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValidRole, type Role } from "@/lib/auth/permissions";
import type { Profile } from "@/types/database";

export interface CurrentUser {
  id: string;
  email: string | null;
  fullName: string | null;
  role: Role;
}

/**
 * The signed-in user and their role, read from the database.
 *
 * The role is never taken from client-supplied data or from JWT metadata a
 * user could influence — it is read from `profiles`, which only an admin can
 * change (enforced by RLS).
 */
export async function getCurrentProfile(): Promise<CurrentUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", user.id)
    .single<Pick<Profile, "id" | "email" | "full_name" | "role">>();

  if (error || !data) {
    // The signup trigger creates the profile. If it is missing, the account is
    // in a broken state — treat it as unauthenticated rather than guessing a
    // role, which would be the one guess with security consequences.
    console.error("No profile row for signed-in user", user.id, error?.message);
    return null;
  }

  if (!isValidRole(data.role)) {
    console.error("Profile has an unrecognised role", data.role);
    return null;
  }

  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    role: data.role,
  };
}

/** Same, but sends anyone without a usable profile to the login page. */
export async function requireProfile(): Promise<CurrentUser> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}
