"use client";

import { CollectUnavailable } from "./CollectUnavailable";
import { RunStatus } from "./RunStatus";
import { useCollectRun } from "./useCollectRun";

/**
 * Collects without leaving the dashboard.
 *
 * Rendered for anyone who can review, whether or not collecting is configured:
 * a button that says why it is unavailable beats one that silently is not
 * there. The route re-checks the caller's role regardless, so this is
 * convenience, not permission.
 */
export function RunIngestButton({
  limit,
  configured,
}: {
  limit?: number;
  configured: boolean;
}) {
  const run = useCollectRun();

  return (
    <div>
      <button
        type="button"
        onClick={() => run.start(limit ? { limit } : undefined)}
        disabled={run.busy || !configured}
        title={configured ? undefined : "Collecting is not configured"}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-40"
      >
        {run.busy ? "Collecting…" : "Collect new articles"}
      </button>

      {configured ? (
        <RunStatus run={run} />
      ) : (
        <div className="mt-3">
          <CollectUnavailable />
        </div>
      )}
    </div>
  );
}
