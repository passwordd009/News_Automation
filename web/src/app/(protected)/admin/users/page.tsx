import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/getCurrentProfile";
import { can } from "@/lib/auth/permissions";
import { getSignupRequests, getUsers } from "@/lib/auth/userQueries";
import { RoleSelect } from "@/components/admin/RoleSelect";
import { SignupRequests } from "@/components/admin/SignupRequests";

export const metadata = { title: "Users · Project Hestia" };

/**
 * Who has an account, and what they may do.
 *
 * Roles change here and nowhere else. RLS is what actually enforces it —
 * `profiles_admin_manage` is the only policy permitting an update to someone
 * else's row — so this page is the interface to that rule, not the rule.
 */
export default async function UsersPage() {
  const profile = await requireProfile();
  if (!can(profile.role, "manageUserRoles")) redirect("/dashboard?denied=1");

  const [{ users, error }, requests] = await Promise.all([
    getUsers(),
    getSignupRequests(),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="border-l-4 border-accent pl-4">
        <h1 className="text-xs font-semibold uppercase tracking-widest text-accent">
          Users
        </h1>
        <p className="mt-1 text-2xl font-semibold tracking-tight">
          {users.length} {users.length === 1 ? "account" : "accounts"}
        </p>
        <p className="mt-1 text-sm text-muted">
          A new signup can read nothing until an admin accepts it. Accepted
          accounts start as Content Creators and are promoted here.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-negative/40 bg-negative/5 px-4 py-3"
        >
          <p className="text-sm font-medium text-negative">The user list could not be read</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{error}</p>
        </div>
      )}

      <SignupRequests waiting={requests.waiting} expired={requests.expired} />

      {requests.error && (
        <p role="alert" className="mt-4 text-sm text-negative">
          {requests.error}
        </p>
      )}

      <h2 className="mt-10 text-xs font-semibold uppercase tracking-widest text-muted">
        Accounts
      </h2>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">Name</th>
              <th scope="col" className="px-4 py-3 font-semibold">Email</th>
              <th scope="col" className="px-4 py-3 font-semibold">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = user.id === profile.id;
              return (
                <tr key={user.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    {user.full_name || <span className="text-muted">—</span>}
                    {isSelf && (
                      <span className="ml-2 text-xs uppercase tracking-wider text-accent">
                        you
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{user.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <RoleSelect
                      userId={user.id}
                      role={user.role}
                      disabled={isSelf}
                      disabledReason={
                        isSelf ? "You cannot change your own role." : undefined
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {users.length === 0 && !error && (
          <p className="px-4 py-8 text-center text-sm text-muted">No accounts yet.</p>
        )}
      </div>
    </main>
  );
}
