import { formatScore } from "@/lib/format";
import type { Article } from "@/types/database";

const DIMENSIONS = [
  { key: "nyc_relevance_score", label: "NYC Relevance", weight: "30%" },
  { key: "community_value_score", label: "Community Value", weight: "25%" },
  { key: "informative_score", label: "Informative", weight: "20%" },
  { key: "credibility_score", label: "Credibility", weight: "15%" },
  { key: "positivity_score", label: "Positivity", weight: "5%" },
  { key: "local_event_score", label: "Local Event", weight: "5%" },
] as const;

export function ArticleScores({ article }: { article: Article }) {
  const hasScores = DIMENSIONS.some((d) => article[d.key] !== null);

  if (!hasScores) {
    // Two different situations: the model was never asked (collected without
    // screening), or it was asked and failed. Only the second has a reason.
    return (
      <p className="text-sm text-muted">
        {article.ai_rejection_reason
          ? `Not scored — ${article.ai_rejection_reason}`
          : "Not screened by AI. Judge it from the headline and summary."}
      </p>
    );
  }

  return (
    <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
      {DIMENSIONS.map(({ key, label, weight }) => {
        const value = article[key];
        return (
          <div key={key} className="flex items-center gap-3 text-sm">
            <dt className="w-32 shrink-0 text-muted">{label}</dt>
            <dd className="flex flex-1 items-center gap-2">
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"
                role="presentation"
              >
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${((value ?? 0) / 10) * 100}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right tabular-nums">
                {formatScore(value)}
              </span>
              <span className="w-8 shrink-0 text-right text-xs text-muted">
                {weight}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
