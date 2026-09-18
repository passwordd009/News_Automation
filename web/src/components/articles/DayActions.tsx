"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearDay } from "@/lib/articles/mutations";
import { RunStatus } from "./RunStatus";
import { useCollectRun } from "./useCollectRun";

/**
 * Collect and clear, for one day.
 *
 * Clearing permanently deletes that day's undecided articles, so it asks
 * first and says exactly how many will go.
 *
 * Collecting hands the work to GitHub Actions and watches the run, because a
 * deployed dashboard has no Python and no model to run it against. The wait is
 * minutes rather than seconds; the page refreshes itself when the run lands.
 */
export function DayActions({
  day,
  label,
  pendingCount,
  canCollect,
  canClear,
}: {
  day: string;
  label: string;
  pendingCount: number;
  canCollect: boolean;
  canClear: boolean;
}) {
  const router = useRouter();
  const run = useCollectRun();
  const [busy, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function clear() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await clearDay(day);
      setConfirming(false);
      if (result.ok) {
        setMessage(`Deleted ${result.deleted} article${result.deleted === 1 ? "" : "s"}.`);
        router.refresh();
      } else {
        setError(result.error ?? "Could not clear the day.");
      }
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface px-5 py-4">
      {confirming ? (
        <div>
          <p className="text-sm font-medium">
            Delete {pendingCount} undecided article{pendingCount === 1 ? "" : "s"} from {label}?
          </p>
          <p className="mt-1 text-sm text-muted">
            This cannot be undone. Anything already approved or declined is kept.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-sm transition hover:text-foreground disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={busy}
              className="rounded-md bg-negative px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Deleting…" : `Delete ${pendingCount}`}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {canCollect && (
              <button
                type="button"
                onClick={() => run.start({ date: day })}
                disabled={run.busy}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
              >
                {run.busy ? "Collecting…" : `Collect ${label}'s news`}
              </button>
            )}

            {canClear && pendingCount > 0 && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-md border border-border px-3 py-2 text-sm transition hover:border-negative hover:text-negative"
              >
                Clear {label}
              </button>
            )}

            {message && <span className="text-xs text-positive">{message}</span>}
          </div>

          <RunStatus run={run} />
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
