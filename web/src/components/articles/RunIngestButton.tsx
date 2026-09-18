"use client";

import { RunStatus } from "./RunStatus";
import { useCollectRun } from "./useCollectRun";

/**
 * Collects without leaving the dashboard.
 *
 * Only rendered when the server says collection is configured — but the route
 * re-checks that and the caller's role, so the button is convenience, not
 * permission.
 */
export function RunIngestButton({ limit }: { limit?: number }) {
  const run = useCollectRun();

  return (
    <div>
      <button
        type="button"
        onClick={() => run.start(limit ? { limit } : undefined)}
        disabled={run.busy}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
      >
        {run.busy ? "Collecting…" : "Collect new articles"}
      </button>

      <RunStatus run={run} />
    </div>
  );
}
