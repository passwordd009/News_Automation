"use client";

import type { CollectRun } from "./useCollectRun";
import { runLabel } from "./useCollectRun";

/**
 * What the collection is doing, shared by every button that starts one.
 *
 * Always offers the link to the run: when it works, that is where the counts
 * are, and when it does not, that is where the reason is. The dashboard cannot
 * see inside a runner, so pretending to explain a failure it did not witness
 * would be worse than pointing at the log.
 */
export function RunStatus({ run }: { run: CollectRun }) {
  const progress = runLabel(run.state);

  if (run.state === "idle") return null;

  return (
    <div className="mt-3 text-xs">
      {progress && (
        <p className="flex items-center gap-2 text-muted">
          <span
            aria-hidden="true"
            className="inline-block size-1.5 animate-pulse rounded-full bg-accent"
          />
          {progress}
          {run.url && (
            <a
              href={run.url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-accent"
            >
              View run
            </a>
          )}
        </p>
      )}

      {run.state === "succeeded" && (
        <p className="text-positive">
          Collection finished — the queue below is up to date.{" "}
          {run.url && (
            <a
              href={run.url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              View run
            </a>
          )}
        </p>
      )}

      {run.state === "failed" && (
        <div role="alert" className="rounded-md border border-border bg-surface px-3 py-2">
          <p className="font-medium text-negative">Collection failed</p>
          {(run.error || run.detail) && (
            <p className="mt-1 whitespace-pre-wrap text-muted">{run.error ?? run.detail}</p>
          )}
          <p className="mt-2 flex gap-3">
            {run.url && (
              <a
                href={run.url}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4 hover:text-accent"
              >
                Open the run log
              </a>
            )}
            <button
              type="button"
              onClick={run.dismiss}
              className="text-muted underline underline-offset-4 hover:text-foreground"
            >
              Dismiss
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
