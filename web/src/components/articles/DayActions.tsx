"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearDay } from "@/lib/articles/mutations";

export interface ScreeningStatus {
  ready: boolean;
  model: string;
  hint?: string;
}

/**
 * Collect and clear, for one day.
 *
 * Clearing permanently deletes that day's undecided articles, so it asks
 * first and says exactly how many will go.
 *
 * The screening line is not decoration. Collection deliberately succeeds
 * without the model, so "Reviewed: 0" in a green summary can mean either
 * "screened and recommended nothing" or "never screened at all" — states worth
 * telling apart before you spend an hour reading an unranked queue.
 */
export function DayActions({
  day,
  label,
  pendingCount,
  canCollect,
  canClear,
  screening,
}: {
  day: string;
  label: string;
  pendingCount: number;
  canCollect: boolean;
  canClear: boolean;
  screening?: ScreeningStatus | null;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [collecting, setCollecting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function collect() {
    setCollecting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/ingest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: day }),
      });
      const data = await response.json();

      if (response.ok) {
        setMessage(data.summary ?? "Done.");
        router.refresh();
      } else {
        setError(data.error ?? "The collection failed.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setCollecting(false);
    }
  }

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
        <div className="flex flex-wrap items-center gap-3">
          {canCollect && (
            <button
              type="button"
              onClick={collect}
              disabled={collecting}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
            >
              {collecting ? "Collecting…" : `Collect ${label}'s news`}
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

          {collecting && (
            <span className="text-xs text-muted">
              Fetching the feeds and keeping what appeared on {label}.
            </span>
          )}
          {message && <span className="text-xs text-positive">{message}</span>}
        </div>
      )}

      {canCollect && screening && !confirming && (
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
          {screening.ready ? (
            <>
              <span className="text-positive">AI screening on</span> · {screening.model}.
              Collected articles arrive scored and ranked.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">AI screening off</span> —
              articles will arrive unscored, in feed order.{" "}
              {screening.hint && <span className="block mt-1">{screening.hint}</span>}
            </>
          )}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
