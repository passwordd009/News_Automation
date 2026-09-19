"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideAccess } from "@/lib/auth/userMutations";
import { timeLeft } from "@/lib/auth/approval";
import type { SignupRequest } from "@/lib/auth/userQueries";

/**
 * Accounts asking to be let in.
 *
 * Declining asks first. Approving does not — letting someone in is the
 * expected answer, and is undone by changing their role or declining later.
 * Turning someone away is the one that reads as final to the person waiting.
 */
export function SignupRequests({
  waiting,
  expired,
}: {
  waiting: SignupRequest[];
  expired: SignupRequest[];
}) {
  if (waiting.length === 0 && expired.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-accent">
        Waiting for approval
        {waiting.length > 0 && (
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] tabular-nums text-white">
            {waiting.length}
          </span>
        )}
      </h2>
      <p className="mt-1 text-xs text-muted">
        A new account can read nothing until you accept it. Requests last 72 hours.
      </p>

      <ul className="mt-4 space-y-2">
        {waiting.map((request) => (
          <RequestRow key={request.id} request={request} />
        ))}
        {expired.map((request) => (
          <RequestRow key={request.id} request={request} lapsed />
        ))}
      </ul>
    </section>
  );
}

function RequestRow({
  request,
  lapsed = false,
}: {
  request: SignupRequest;
  lapsed?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function decide(decision: "approved" | "declined") {
    setError(null);
    startTransition(async () => {
      const result = await decideAccess(request.id, decision);
      if (result.ok) router.refresh();
      else {
        setConfirmingDecline(false);
        setError(result.error ?? "Could not record that.");
      }
    });
  }

  return (
    <li
      className={[
        "rounded-lg border px-4 py-3",
        lapsed ? "border-dashed border-border" : "border-border bg-surface",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {request.fullName || request.email || "Unnamed account"}
          </p>
          <p className="truncate text-xs text-muted">
            {request.fullName && request.email ? `${request.email} · ` : ""}
            {lapsed ? (
              <span className="text-negative">
                lapsed — nobody answered in 72 hours
              </span>
            ) : (
              timeLeft(request.requestedAt)
            )}
          </p>
        </div>

        {confirmingDecline ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Turn them away?</span>
            <button
              type="button"
              onClick={() => setConfirmingDecline(false)}
              disabled={pending}
              className="rounded-md border border-border px-2.5 py-1 text-xs transition hover:text-foreground disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => decide("declined")}
              disabled={pending}
              className="rounded-md bg-negative px-3 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "…" : "Decline"}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmingDecline(true)}
              disabled={pending}
              className="rounded-md border border-border px-3 py-1.5 text-xs transition hover:border-negative hover:text-negative disabled:opacity-60"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => decide("approved")}
              disabled={pending}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
            >
              {pending ? "Saving…" : lapsed ? "Accept anyway" : "Accept"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-negative">
          {error}
        </p>
      )}
    </li>
  );
}
