"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearDay } from "@/lib/articles/mutations";
import { CollectUnavailable } from "./CollectUnavailable";
import { RunStatus } from "./RunStatus";
import { useCollectRun } from "./useCollectRun";

/**
 * Collect and clear, for one day.
 *
 * Collecting is deliberately narrow: today only, and only into an empty day.
 *
 * On any other day the button is not disabled, it is absent — a past day
 * cannot be collected in any useful sense, because feeds carry only their
 * recent entries, so the request would run for minutes on a runner and return
 * nothing. A permanently greyed control is just clutter with an explanation
 * attached. Clearing still applies, so that is all a past day offers.
 *
 * On today, a day that already holds articles keeps the button but disables
 * it: a second run adds almost nothing, since deduplication drops everything
 * already stored. There the explanation is worth having, because the block
 * lifts as soon as the day is cleared or decided.
 *
 * Both rules are re-checked in the API route. This component decides what to
 * offer, not what is allowed.
 */
export function DayActions({
  day,
  label,
  pendingCount,
  isToday,
  collectConfigured,
  canClear,
}: {
  day: string;
  label: string;
  pendingCount: number;
  isToday: boolean;
  collectConfigured: boolean;
  canClear: boolean;
}) {
  const router = useRouter();
  const run = useCollectRun();
  const [busy, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only today offers collection at all; on today, a populated day blocks it
  // until it is cleared or worked through.
  const blocked =
    isToday && pendingCount > 0
      ? `Today already holds ${pendingCount} undecided article${
          pendingCount === 1 ? "" : "s"
        }. Decide on them, or clear the day, before collecting again.`
      : null;

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
            {isToday && (
              <button
                type="button"
                onClick={() => run.start({ date: day })}
                disabled={run.busy || !collectConfigured || blocked !== null}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-40"
              >
                {run.busy ? "Collecting…" : "Collect today's news"}
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

          {!isToday ? null : !collectConfigured ? (
            <div className="mt-3">
              <CollectUnavailable />
            </div>
          ) : (
            <>
              {blocked && run.state === "idle" && (
                <p className="mt-3 text-xs leading-relaxed text-muted">{blocked}</p>
              )}
              <RunStatus run={run} />
            </>
          )}
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
