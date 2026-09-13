"use client";

import { useState, useTransition } from "react";
import { approveArticle, declineArticle } from "@/lib/articles/mutations";
import { ArticleScores } from "@/components/articles/ArticleScores";
import { formatDate, formatScore } from "@/lib/format";
import type { Article } from "@/types/database";

export function ReviewArticleCard({ article }: { article: Article }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [decliningOpen, setDecliningOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [settled, setSettled] = useState<"approved" | "declined" | null>(null);

  const isReconsideration = article.status === "reconsideration_requested";

  function run(action: () => Promise<{ ok: boolean; error?: string }>, outcome: "approved" | "declined") {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) setSettled(outcome);
      else setError(result.error ?? "Something went wrong.");
    });
  }

  // Keep the card in place after a decision rather than yanking it out from
  // under the cursor — the reviewer sees what they just did, and the queue
  // re-sorts on the next load.
  if (settled) {
    return (
      <article className="rounded-lg border border-border bg-surface px-5 py-4 opacity-70">
        <p className="text-sm">
          <span
            className={
              settled === "approved"
                ? "font-medium text-positive"
                : "font-medium text-muted"
            }
          >
            {settled === "approved" ? "Approved" : "Declined"}
          </span>{" "}
          — {article.title}
        </p>
      </article>
    );
  }

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-surface">
      {isReconsideration && (
        <p className="border-b border-accent-border bg-accent-soft px-5 py-2 text-xs font-medium uppercase tracking-wider text-accent-strong">
          Reconsideration requested
        </p>
      )}

      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {article.topic && (
            <span className="text-xs font-semibold uppercase tracking-widest text-accent">
              {article.topic}
            </span>
          )}
          {article.borough && article.borough !== "Citywide" && (
            <span className="text-xs text-muted">· {article.borough}</span>
          )}
          {article.ai_recommended && (
            <span className="ml-auto rounded-full border border-accent-border bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong">
              AI recommends
            </span>
          )}
        </div>

        <h2 className="mt-2 text-lg font-semibold leading-snug tracking-tight">
          {article.title}
        </h2>

        <p className="mt-1 text-sm text-muted">
          {article.source ?? "Unknown source"} · {formatDate(article.published_at)}
          {article.overall_score !== null && (
            <>
              {" · "}
              <span className="font-medium text-foreground">
                Score {formatScore(article.overall_score)}
              </span>
            </>
          )}
        </p>

        {article.decline_reason && (
          <p className="mt-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
            <span className="font-medium">Previously declined:</span>{" "}
            {article.decline_reason}
          </p>
        )}

        <div className="mt-4">
          <ArticleScores article={article} />
        </div>

        {article.description && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Description
            </h3>
            <p className="mt-1 text-sm leading-relaxed">{article.description}</p>
          </div>
        )}

        {article.why_post && (
          <div className="mt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Why post
            </h3>
            <p className="mt-1 text-sm leading-relaxed">{article.why_post}</p>
          </div>
        )}

        {!article.description && article.raw_description && (
          <p className="mt-4 text-sm leading-relaxed text-muted">
            {article.raw_description}
          </p>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-negative">
            {error}
          </p>
        )}

        {decliningOpen && (
          <div className="mt-4 rounded-md border border-border bg-background p-3">
            <label
              htmlFor={`reason-${article.id}`}
              className="block text-sm font-medium"
            >
              Why is this being declined? <span className="text-muted">(optional)</span>
            </label>
            <textarea
              id={`reason-${article.id}`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Too similar to another selected article."
              className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            />
            <p className="mt-1.5 text-xs text-muted">
              Content Creators can see this and may ask you to reconsider.
            </p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-border px-3 py-1.5 text-sm transition hover:border-accent-border hover:text-accent-strong"
          >
            Open source ↗
          </a>

          <div className="ml-auto flex flex-wrap gap-2">
            {decliningOpen ? (
              <>
                <button
                  type="button"
                  onClick={() => setDecliningOpen(false)}
                  disabled={pending}
                  className="rounded-md px-3 py-1.5 text-sm text-muted transition hover:text-foreground disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => run(() => declineArticle(article.id, reason), "declined")}
                  disabled={pending}
                  className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition hover:border-negative hover:text-negative disabled:opacity-60"
                >
                  {pending ? "Declining…" : "Confirm decline"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setDecliningOpen(true)}
                disabled={pending}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition hover:border-negative hover:text-negative disabled:opacity-60"
              >
                Decline
              </button>
            )}

            <button
              type="button"
              onClick={() => run(() => approveArticle(article.id), "approved")}
              disabled={pending}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
            >
              {pending ? "Working…" : "Approve"}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
