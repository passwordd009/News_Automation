import { formatDate } from "@/lib/format";
import type { Article } from "@/types/database";

/**
 * One story in the weekly feed.
 *
 * Ordered as §15 asks: topic, then title, then description, then why post,
 * then the source. A content creator reads top to bottom and has everything
 * they need to write the post.
 */
export function ApprovedArticleCard({ article }: { article: Article }) {
  return (
    <article className="border-l-2 border-accent-border pl-5 transition hover:border-accent">
      {article.topic && (
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">
          {article.topic}
          {article.borough && article.borough !== "Citywide" && (
            <span className="font-normal text-muted"> · {article.borough}</span>
          )}
        </p>
      )}

      <h2 className="mt-1.5 text-xl font-semibold leading-snug tracking-tight">
        {article.title}
      </h2>

      {article.description ? (
        <p className="mt-3 leading-relaxed">{article.description}</p>
      ) : article.raw_description ? (
        <p className="mt-3 leading-relaxed">{article.raw_description}</p>
      ) : null}

      {article.why_post && (
        <div className="mt-4 rounded-md border border-accent-border bg-accent-soft px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-accent-strong">
            Why post
          </h3>
          <p className="mt-1 text-sm leading-relaxed">{article.why_post}</p>
        </div>
      )}

      <p className="mt-4 text-sm text-muted">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline underline-offset-4 hover:text-accent"
        >
          {article.source ?? "Read the article"} ↗
        </a>
        {article.published_at && <> · {formatDate(article.published_at)}</>}
      </p>
    </article>
  );
}
