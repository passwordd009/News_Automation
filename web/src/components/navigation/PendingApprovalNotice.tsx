import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { requestState, timeLeft } from "@/lib/auth/approval";

/**
 * What someone sees between signing up and being let in.
 *
 * This replaces the whole app rather than sitting on top of it, because there
 * is nothing underneath: RLS returns an unapproved account no articles at all,
 * so every page would render empty and look broken instead of pending.
 *
 * The three outcomes read differently on purpose. Waiting is a normal state
 * with a deadline. Expired is not a refusal — nobody got to it — and the way
 * out is a person, so it says to ask one. Declined is a decision, and pretending
 * otherwise would leave someone refreshing forever.
 */
export function PendingApprovalNotice({
  email,
  requestedAt,
  declined,
}: {
  email: string | null;
  requestedAt: string;
  declined: boolean;
}) {
  const expired = !declined && requestState(requestedAt) === "expired";

  return (
    <AuthPageShell
      title={declined ? "Not approved" : expired ? "Request expired" : "Waiting for approval"}
      subtitle={email ?? "Your account"}
    >
      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        {declined ? (
          <p className="text-sm leading-relaxed">
            An admin did not approve this account. If you think that was a
            mistake, ask them directly — nothing here will change it.
          </p>
        ) : expired ? (
          <>
            <p className="text-sm leading-relaxed">
              Nobody answered this request within{" "}
              <span className="font-medium">72 hours</span>, so it is no longer
              waiting.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              It has not been refused — it simply lapsed. An admin can still
              accept it; ask one to take a look.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed">
              Your account exists and an admin has been asked to approve it.
              You will be able to sign straight in once they do.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Requests last 72 hours —{" "}
              <span className="text-foreground">{timeLeft(requestedAt)}</span>. If
              it lapses, an admin can still accept it, but someone has to ask.
            </p>
          </>
        )}

        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="mt-6 w-full rounded-md border border-border px-4 py-2 text-sm transition hover:text-accent"
          >
            Sign out
          </button>
        </form>
      </div>
    </AuthPageShell>
  );
}
