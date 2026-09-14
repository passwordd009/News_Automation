/**
 * Shown when someone is authenticated but has no `profiles` row.
 *
 * Without a profile there is no role, so the account cannot be used. Rather
 * than bouncing them to /login — which loops, because their session is
 * perfectly valid — say exactly what is wrong and how to fix it.
 */
export function AccountSetupNotice({
  email,
  userId,
}: {
  email: string | null;
  userId: string;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-12">
      <div className="w-full">
        <div className="mb-3 h-1 w-12 bg-accent" />
        <h1 className="text-2xl font-semibold tracking-tight">
          Your account has no profile yet
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-muted">
          You are signed in as <span className="text-foreground">{email}</span>,
          but there is no matching row in <code>profiles</code> — so the app
          cannot tell what you are allowed to do. It will not guess a role.
        </p>

        <div className="mt-6 rounded-lg border border-accent-border bg-accent-soft p-4">
          <h2 className="text-sm font-semibold text-accent-strong">
            How to fix it
          </h2>
          <p className="mt-2 text-sm text-foreground">
            A profile is created automatically on signup by a database trigger.
            If yours is missing, that trigger had not been applied when you
            registered. Apply the migrations and the backfill will pick you up:
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-surface p-3 text-xs">
            supabase db push
          </pre>
          <p className="mt-3 text-sm text-foreground">
            Then sign out and back in. To make yourself an admin, edit the email
            in <code>supabase/seed_admin.sql</code> and run it once.
          </p>
        </div>

        <p className="mt-6 text-xs text-muted">
          User ID: <code>{userId}</code>
        </p>

        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="rounded-md border border-border px-4 py-2 text-sm transition hover:border-accent-border hover:text-accent-strong"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
