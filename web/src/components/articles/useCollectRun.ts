"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Starting a collection and watching it finish.
 *
 * A dispatched run takes minutes, not seconds: GitHub has to pick up the job,
 * install Ollama, restore the weights and screen every article. So the button
 * cannot report a result — it reports a run, and this polls until that run
 * ends, then refreshes the page so the new articles appear without asking
 * anyone to reload.
 */

export type RunState = "idle" | "starting" | "queued" | "running" | "succeeded" | "failed";

interface Handle {
  requestId: string;
  runId: number | null;
  url: string | null;
}

const POLL_MS = 5_000;

// Runs are allowed 120 minutes by the workflow. Polling forever after that
// would keep a tab hitting the API over a run nobody is waiting for.
const GIVE_UP_MS = 125 * 60 * 1000;

export interface CollectRun {
  state: RunState;
  /** The Actions run, as soon as GitHub lists it. */
  url: string | null;
  error: string | null;
  detail: string | null;
  busy: boolean;
  start: (body?: { date?: string; limit?: number }) => Promise<void>;
  dismiss: () => void;
}

export function useCollectRun(): CollectRun {
  const router = useRouter();
  const [state, setState] = useState<RunState>("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [handle, setHandle] = useState<Handle | null>(null);

  const startedAt = useRef(0);

  const start = useCallback(async (body?: { date?: string; limit?: number }) => {
    setState("starting");
    setError(null);
    setDetail(null);
    setUrl(null);

    try {
      const response = await fetch("/api/ingest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await response.json();

      if (!response.ok) {
        setState("failed");
        setError(data.error ?? "Could not start the run.");
        return;
      }

      startedAt.current = Date.now();
      setHandle(data as Handle);
      setUrl(data.url ?? null);
      setState("queued");
    } catch {
      setState("failed");
      setError("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    if (!handle || (state !== "queued" && state !== "running")) return;

    let cancelled = false;

    const timer = setInterval(async () => {
      if (Date.now() - startedAt.current > GIVE_UP_MS) {
        clearInterval(timer);
        if (!cancelled) {
          setState("failed");
          setError("Gave up waiting. The run may still be going — open it to check.");
        }
        return;
      }

      try {
        const query = new URLSearchParams({ requestId: handle.requestId });
        if (handle.runId) query.set("runId", String(handle.runId));

        const response = await fetch(`/api/ingest/run?${query}`);
        const data = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          setState("failed");
          setError(data.error ?? "Lost track of the run.");
          return;
        }

        if (data.url) setUrl(data.url);
        // Once GitHub lists the run, keep its id so later polls skip the search.
        if (data.runId && !handle.runId) {
          setHandle((current) => (current ? { ...current, runId: data.runId } : current));
        }

        if (data.state === "succeeded") {
          setState("succeeded");
          router.refresh(); // pull in whatever landed in the queue
        } else if (data.state === "failed" || data.state === "cancelled") {
          setState("failed");
          setDetail(data.detail ?? null);
        } else {
          setState(data.state === "running" ? "running" : "queued");
        }
      } catch {
        // A single failed poll is not a failed run — a laptop lid, a flaky
        // network. Keep polling; the give-up timer is the real backstop.
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [handle, state, router]);

  const dismiss = useCallback(() => {
    setState("idle");
    setError(null);
    setDetail(null);
    setUrl(null);
    setHandle(null);
  }, []);

  return {
    state,
    url,
    error,
    detail,
    busy: state === "starting" || state === "queued" || state === "running",
    start,
    dismiss,
  };
}

/** What the button says while a run is in flight. */
export function runLabel(state: RunState): string | null {
  switch (state) {
    case "starting":
      return "Asking GitHub to start…";
    case "queued":
      return "Waiting for a runner…";
    case "running":
      return "Collecting and screening — this takes a few minutes.";
    default:
      return null;
  }
}
