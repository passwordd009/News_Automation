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
 * Four distinct states, not two.
 *
 * "Signed in but has no profile" is not the same as "signed out", and
 * collapsing them causes a redirect loop: the layout sends the user to /login
 * because they have no role, the proxy sees a valid session and sends them
 * back to /dashboard, forever. Keeping the states separate lets the app say
 * what is actually wrong.
 *
 * "Waiting for approval" is the fourth, and is a real session with a real
 * profile — the account simply has not been let in yet. It carries the
 * request's age so the screen can say how long is left.
 */
export type AuthState =
  | { status: "anonymous" }
  | { status: "no-profile"; userId: string; email: string | null }
  | {
      status: "not-approved";
      email: string | null;
      requestedAt: string;
      declined: boolean;
    }
  | { status: "ok"; user: CurrentUser };

export async function getAuthState(): Promise<AuthState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { status: "anonymous" };

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, access_status, requested_at")
    .eq("id", user.id)
    .maybeSingle<
      Pick<Profile, "id" | "email" | "full_name" | "role" | "access_status" | "requested_at">
    >();

  if (error) {
    console.error("Could not read the profile for", user.id, error.message);
    return { status: "no-profile", userId: user.id, email: user.email ?? null };
  }

  if (!data) {
    // The signup trigger should have created this. If it is missing, the
    // account genuinely cannot be used — never default it to a role, since
    // that is the one guess with security consequences.
    return { status: "no-profile", userId: user.id, email: user.email ?? null };
  }

  if (!isValidRole(data.role)) {
    console.error("Profile has an unrecognised role:", data.role);
    return { status: "no-profile", userId: user.id, email: user.email ?? null };
  }

  // An account nobody has accepted has a role on paper and none in practice —
  // RLS returns it nothing. Say so here rather than rendering empty pages.
  if (data.access_status !== "approved") {
    return {
      status: "not-approved",
      email: data.email ?? user.email ?? null,
      requestedAt: data.requested_at,
      declined: data.access_status === "declined",
    };
  }

  return {
    status: "ok",
    user: {
      id: data.id,
      email: data.email,
      fullName: data.full_name,
      role: data.role,
    },
  };
}

/** The signed-in user, or null if they are not usable. */
export async function getCurrentProfile(): Promise<CurrentUser | null> {
  const state = await getAuthState();
  return state.status === "ok" ? state.user : null;
}

/**
 * The signed-in user, redirecting only when they are genuinely signed out.
 *
 * A missing profile is deliberately NOT redirected — the protected layout
 * renders an explanation instead.
 */
export async function requireProfile(): Promise<CurrentUser> {
  const state = await getAuthState();
  if (state.status === "ok") return state.user;
  if (state.status === "anonymous") redirect("/login");
  // Reached only if a page calls this directly; the layout handles it first.
  redirect("/account-setup");
}
