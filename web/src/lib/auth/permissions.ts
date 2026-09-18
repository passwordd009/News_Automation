/**
 * The §6 authorization matrix, in one place.
 *
 * Every role check in the UI goes through `can()`. Duplicating conditions
 * across components is how a page ends up disagreeing with the rest of the app
 * about who may do what.
 *
 * This governs what the interface *offers*. It is not the security boundary —
 * Supabase Row Level Security is, and it is enforced independently in the
 * database. Hiding a button is not access control.
 */

export const ROLES = ["admin", "approver", "content_creator"] as const;
export type Role = (typeof ROLES)[number];

export type Capability =
  | "viewPendingQueue"
  | "approveArticle"
  | "declineArticle"
  | "viewApproved"
  | "viewArchive"
  | "viewDeclined"
  | "requestReconsideration"
  | "resolveReconsideration"
  | "editEditorialFields"
  | "manageUserRoles"
  | "manageWeeklyPeriods";

const MATRIX: Record<Capability, readonly Role[]> = {
  viewPendingQueue: ["admin", "approver"],
  approveArticle: ["admin", "approver"],
  declineArticle: ["admin", "approver"],
  viewApproved: ["admin", "approver", "content_creator"],
  viewArchive: ["admin", "approver", "content_creator"],
  viewDeclined: ["admin", "approver", "content_creator"],
  requestReconsideration: ["admin", "content_creator"],
  resolveReconsideration: ["admin", "approver"],
  editEditorialFields: ["admin", "approver"],
  manageUserRoles: ["admin"],
  manageWeeklyPeriods: ["admin"],
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[capability].includes(role);
}

/** Admin or approver — the two roles that make editorial decisions. */
export function isReviewer(role: Role | null | undefined): boolean {
  return role === "admin" || role === "approver";
}

export function isValidRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  approver: "Approver",
  content_creator: "Content Creator",
};

/** Which routes each role may open, checked server-side by the layout guard. */
export const ROUTE_CAPABILITIES: Record<string, Capability | null> = {
  "/dashboard": null, // any signed-in user
  "/account": null, // your own profile; RLS scopes it to your row
  "/review": "viewPendingQueue",
  "/approved": "viewApproved",
  "/declined": "viewDeclined",
  "/archive": "viewArchive",
  "/admin/users": "manageUserRoles",
};

export function capabilityForPath(pathname: string): Capability | null | undefined {
  const match = Object.keys(ROUTE_CAPABILITIES)
    .filter((route) => pathname === route || pathname.startsWith(`${route}/`))
    // Longest prefix wins, so /admin/users beats a future /admin.
    .sort((a, b) => b.length - a.length)[0];

  return match ? ROUTE_CAPABILITIES[match] : undefined;
}
