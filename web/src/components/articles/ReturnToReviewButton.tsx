"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { returnToReview } from "@/lib/articles/mutations";

/**
 * Sends an approved story back to the review queue.
 *
 * Confirms first. The decision itself is reversible, but the article rejoins a
 * day's queue and its approval stamp is cleared, so it is not a click to make
 * by accident while reading the week.
 */
export function ReturnToReviewButton({ articleId }: { articleId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return <p className="mt-4 text-xs text-muted">Sent back to the review queue.</p>;
  }

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await returnToReview(articleId);
      if (result.ok) {
        setDone(true);
        router.refresh();
      } else {
        setConfirming(false);
        setError(result.error ?? "Could not send it back.");
      }
    });
  }

  return (
    <div className="mt-4">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Send back for another decision?</span>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="rounded-md border border-border px-2.5 py-1 text-xs transition hover:text-foreground disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={pending}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
          >
            {pending ? "Sending…" : "Send back"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-xs text-muted underline underline-offset-4 transition hover:text-accent"
        >
          Send back to review
        </button>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
