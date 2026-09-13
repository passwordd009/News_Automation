import { describe, expect, it } from "vitest";
import {
  ROLES,
  can,
  capabilityForPath,
  isReviewer,
  isValidRole,
  type Capability,
} from "./permissions";

/**
 * These assert the §6 matrix as the UI understands it.
 *
 * They are not a security test — Supabase RLS is the enforcement layer, and
 * supabase/tests/rls_test.sql proves that independently. These catch the UI
 * offering an action the database will refuse, which is a bug even though it
 * is not a hole.
 */

describe("content creator", () => {
  const role = "content_creator" as const;

  it("cannot reach the pending queue", () => {
    expect(can(role, "viewPendingQueue")).toBe(false);
  });

  it("cannot approve or decline", () => {
    expect(can(role, "approveArticle")).toBe(false);
    expect(can(role, "declineArticle")).toBe(false);
  });

  it("cannot edit editorial fields or manage roles", () => {
    expect(can(role, "editEditorialFields")).toBe(false);
    expect(can(role, "manageUserRoles")).toBe(false);
    expect(can(role, "manageWeeklyPeriods")).toBe(false);
  });

  it("can view approved, declined and archived content", () => {
    expect(can(role, "viewApproved")).toBe(true);
    expect(can(role, "viewDeclined")).toBe(true);
    expect(can(role, "viewArchive")).toBe(true);
  });

  it("can request reconsideration but not resolve it", () => {
    expect(can(role, "requestReconsideration")).toBe(true);
    expect(can(role, "resolveReconsideration")).toBe(false);
  });
});

describe("approver", () => {
  const role = "approver" as const;

  it("can make editorial decisions", () => {
    expect(can(role, "viewPendingQueue")).toBe(true);
    expect(can(role, "approveArticle")).toBe(true);
    expect(can(role, "declineArticle")).toBe(true);
    expect(can(role, "resolveReconsideration")).toBe(true);
    expect(can(role, "editEditorialFields")).toBe(true);
  });

  it("has no administrative controls", () => {
    expect(can(role, "manageUserRoles")).toBe(false);
    expect(can(role, "manageWeeklyPeriods")).toBe(false);
  });
});

describe("admin", () => {
  it("can do everything in the matrix", () => {
    const capabilities: Capability[] = [
      "viewPendingQueue",
      "approveArticle",
      "declineArticle",
      "viewApproved",
      "viewArchive",
      "viewDeclined",
      "requestReconsideration",
      "resolveReconsideration",
      "editEditorialFields",
      "manageUserRoles",
      "manageWeeklyPeriods",
    ];
    for (const capability of capabilities) {
      expect(can("admin", capability), capability).toBe(true);
    }
  });
});

describe("guards", () => {
  it("grants nothing without a role", () => {
    for (const capability of ["viewApproved", "approveArticle"] as Capability[]) {
      expect(can(null, capability)).toBe(false);
      expect(can(undefined, capability)).toBe(false);
    }
  });

  it("identifies the two deciding roles", () => {
    expect(isReviewer("admin")).toBe(true);
    expect(isReviewer("approver")).toBe(true);
    expect(isReviewer("content_creator")).toBe(false);
    expect(isReviewer(null)).toBe(false);
  });

  it("rejects anything that is not a known role", () => {
    expect(isValidRole("admin")).toBe(true);
    expect(isValidRole("superuser")).toBe(false);
    expect(isValidRole("")).toBe(false);
    expect(isValidRole(null)).toBe(false);
    expect(isValidRole({ role: "admin" })).toBe(false);
  });

  it("covers every declared role", () => {
    expect(ROLES).toHaveLength(3);
    for (const role of ROLES) {
      expect(can(role, "viewApproved")).toBe(true);
    }
  });
});

describe("route capabilities", () => {
  it("maps routes and their children to a capability", () => {
    expect(capabilityForPath("/review")).toBe("viewPendingQueue");
    expect(capabilityForPath("/archive")).toBe("viewArchive");
    expect(capabilityForPath("/archive/abc-123")).toBe("viewArchive");
  });

  it("lets the dashboard through for any signed-in user", () => {
    expect(capabilityForPath("/dashboard")).toBeNull();
  });

  it("prefers the most specific route", () => {
    // /admin/users must not be matched by a shorter, more permissive prefix.
    expect(capabilityForPath("/admin/users")).toBe("manageUserRoles");
  });

  it("returns undefined for an unknown route", () => {
    expect(capabilityForPath("/nothing-here")).toBeUndefined();
  });
});
