import { ApprovedArticleCard } from "@/components/articles/ApprovedArticleCard";
import { WeeklyPeriodHeader } from "@/components/weekly/WeeklyPeriodHeader";
import type { Article, WeeklyPeriod } from "@/types/database";

/**
 * A week's approved stories, as one vertical feed.
 *
 * §13 is explicit that the archive must not get its own design, so this is the
 * single component behind both /approved and /archive/[periodId]. One column,
 * scrolled top to bottom — never a grid of small cards.
 */
export function WeeklyArticleList({
  period,
  articles,
  emptyMessage,
  canReturn = false,
}: {
  period: WeeklyPeriod | null;
  articles: Article[];
  emptyMessage?: React.ReactNode;
  /** Whether the reader may send a story back to the queue. */
  canReturn?: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <WeeklyPeriodHeader period={period} count={articles.length} />

      {articles.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted">
          {emptyMessage ?? "Nothing has been approved for this week."}
        </div>
      ) : (
        <ol className="mt-10 space-y-10">
          {articles.map((article) => (
            <li key={article.id}>
              <ApprovedArticleCard article={article} canReturn={canReturn} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
