"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface RunResult {
  ok?: boolean;
  error?: string;
  summary?: string | null;
  output?: string;
  durationMs?: number;
}

/**
 * Runs the collector without leaving the dashboard.
 *
 * Only rendered when the server says the feature is enabled — but the route
 * re-checks that and the caller's role, so the button is convenience, not
 * permission.
 */
export function RunIngestButton({ limit }: { limit?: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [showOutput, setShowOutput] = useState(false);

  async function start() {
    setRunning(true);
    setResult(null);
    setShowOutput(false);

    try {
      const response = await fetch("/api/ingest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limit ? { limit } : {}),
      });
      const data: RunResult = await response.json();
      setResult(data);
      // Pull in whatever landed in the queue.
      if (response.ok) router.refresh();
    } catch {
      setResult({ error: "Could not reach the server." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={start}
          disabled={running}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
        >
          {running ? "Collecting…" : "Collect new articles"}
        </button>

        {running && (
          <span className="text-xs text-muted">
            Screening each article with the model — this can take a few minutes.
          </span>
        )}

        {result?.ok && result.summary && (
          <span className="text-xs text-positive">{result.summary}</span>
        )}
      </div>

      {result?.error && (
        <div
          role="alert"
          className="mt-3 rounded-md border border-border bg-surface px-4 py-3 text-sm"
        >
          <p className="font-medium text-negative">Run failed</p>
          <p className="mt-1 whitespace-pre-wrap text-muted">{result.error}</p>
        </div>
      )}

      {result?.output && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowOutput((open) => !open)}
            className="text-xs text-muted underline underline-offset-4 hover:text-accent"
          >
            {showOutput ? "Hide output" : "Show output"}
          </button>
          {showOutput && (
            <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-surface p-3 text-xs leading-relaxed">
              {result.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
