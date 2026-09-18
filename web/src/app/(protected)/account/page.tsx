import { requireProfile } from "@/lib/auth/getCurrentProfile";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { AccountForm } from "@/components/auth/AccountForm";

export const metadata = { title: "Your account · Project Hestia" };

/**
 * Your own profile.
 *
 * Open to every signed-in role — there is no capability for "edit yourself",
 * because RLS already scopes it to your own row and there is nothing here
 * another person could reach.
 */
export default async function AccountPage() {
  const profile = await requireProfile();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="border-l-4 border-accent pl-4">
        <h1 className="text-xs font-semibold uppercase tracking-widest text-accent">
          Your account
        </h1>
        <p className="mt-1 text-2xl font-semibold tracking-tight">
          {profile.fullName || "No name set"}
        </p>
        <p className="mt-1 text-sm text-muted">
          {profile.email} · {ROLE_LABELS[profile.role]}
        </p>
      </header>

      <h2 className="mt-8 text-sm font-medium">Name</h2>
      <p className="mt-1 text-sm text-muted">
        How you appear to the rest of the newsroom, on the Users page and beside
        the decisions you make.
      </p>

      <AccountForm fullName={profile.fullName} />

      <h2 className="mt-10 text-sm font-medium">Role</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        You are {ROLE_LABELS[profile.role] === "Admin" ? "an" : "a"}{" "}
        {ROLE_LABELS[profile.role]}. Only an admin can change a role, and nobody
        can change their own — the database refuses it outright, not just the
        interface.
      </p>

      <h2 className="mt-10 text-sm font-medium">Password</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Sign out and use{" "}
        <span className="text-foreground">Forgot your password?</span> to set a new
        one by email.
      </p>
    </main>
  );
}
