import { requireProfile } from "@/lib/auth/getCurrentProfile";
import { can } from "@/lib/auth/permissions";
import { getReviewQueue } from "@/lib/articles/queries";
import { ReviewArticleCard } from "@/components/articles/ReviewArticleCard";
import { formatPeriodRange } from "@/lib/format";
import { redirect } from "next/navigation";
import { RunIngestButton } from "@/components/articles/RunIngestButton";

export const metadata = { title: "Review · Project Hestia" };

export default async function ReviewPage() {
  // Checked here as well as in the layout: a page should not depend on a
  // parent's guard for its own authorization.
  const profile = await requireProfile();
  if (!can(profile.role, "viewPendingQueue")) redirect("/dashboard?denied=1");

  const { period, articles } = await getReviewQueue();

  // Server-only flag: the button is hidden unless running the worker locally
  // is enabled. The route enforces it regardless of what is rendered.
  const canRunWorker = process.env.ENABLE_LOCAL_INGEST === "true";

  const recommended = articles.filter((a) => a.ai_recommended).length;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="border-l-4 border-accent pl-4">
        <h1 className="text-xs font-semibold uppercase tracking-widest text-accent">
          Review queue
        </h1>
        <p className="mt-1 text-2xl font-semibold tracking-tight">
          {period
            ? formatPeriodRange(period.start_date, period.end_date)
            : "No active week"}
        </p>
        <p className="mt-1 text-sm text-muted">
          {articles.length === 0
            ? "Nothing waiting."
            : `${articles.length} article${articles.length === 1 ? "" : "s"} awaiting a decision · ${recommended} AI-recommended`}
        </p>
      </header>

      {canRunWorker && (
        <div className="mt-6 rounded-lg border border-border bg-surface px-5 py-4">
          <RunIngestButton />
        </div>
      )}

      {articles.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm font-medium">The queue is empty.</p>
          <p className="mt-2 text-sm text-muted">
            {canRunWorker
              ? "Use the button above to collect and screen new articles."
              : "Run the worker to collect and screen new articles:"}
          </p>
          {!canRunWorker && (
            <code className="mt-3 inline-block rounded bg-background px-3 py-1.5 text-xs">
              python worker/scripts/ingest.py
            </code>
          )}
        </div>
      ) : (
        <>
          <ol className="mt-8 space-y-5">
            {articles.map((article) => (
              <li key={article.id}>
                <ReviewArticleCard article={article} />
              </li>
            ))}
          </ol>

          <p className="mt-10 text-xs leading-relaxed text-muted">
            Sorted with reconsiderations first, then the AI&apos;s
            recommendations, then by score. Everything collected is listed —
            low-scoring stories sink to the bottom rather than being hidden, so
            the decision stays yours.
          </p>
        </>
      )}
    </main>
  );
}
