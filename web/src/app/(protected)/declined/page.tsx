import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/getCurrentProfile";
import { can } from "@/lib/auth/permissions";
import { getDeclined } from "@/lib/articles/queries";
import { Pagination, resolvePage } from "@/components/navigation/Pagination";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Declined · Project Hestia" };

const PER_PAGE = 4;

/**
 * Stories that were turned down, with the reason given.
 *
 * §9 keeps these visible for the rest of the editorial period rather than
 * deleting them on the spot, so a content creator can see what was considered
 * and why — and ask for a second look.
 */
export default async function DeclinedPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const profile = await requireProfile();
  if (!can(profile.role, "viewDeclined")) redirect("/dashboard?denied=1");

  const [{ articles, error }, { page: requestedPage }] = await Promise.all([
    getDeclined(),
    searchParams,
  ]);

  // This list only grows across a period, so it is paged like the queue.
  const pageCount = Math.ceil(articles.length / PER_PAGE);
  const page = resolvePage(requestedPage, pageCount);
  const onThisPage = articles.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="border-l-4 border-accent pl-4">
        <h1 className="text-xs font-semibold uppercase tracking-widest text-accent">
          Declined
        </h1>
        <p className="mt-1 text-2xl font-semibold tracking-tight">
          {articles.length === 0
            ? "Nothing declined"
            : `${articles.length} declined ${articles.length === 1 ? "story" : "stories"}`}
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-negative/40 bg-negative/5 px-4 py-3"
        >
          <p className="text-sm font-medium text-negative">This list could not be read</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{error}</p>
        </div>
      )}

      {!error && articles.length === 0 && (
        <div className="mt-10 rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted">
          Nothing has been declined this period.
        </div>
      )}

      <ol className="mt-10 space-y-6">
        {onThisPage.map((article) => (
          <li key={article.id} className="border-l-2 border-border pl-5">
            <h2 className="text-base font-semibold leading-snug">{article.title}</h2>

            {article.decline_reason && (
              <p className="mt-2 text-sm leading-relaxed text-muted">
                <span className="font-medium text-foreground">Reason:</span>{" "}
                {article.decline_reason}
              </p>
            )}

            <p className="mt-2 text-sm text-muted">
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-accent"
              >
                {article.source ?? "Read the article"} ↗
              </a>
              {article.declined_at && <> · declined {formatDate(article.declined_at)}</>}
            </p>
          </li>
        ))}
      </ol>

      <Pagination
        page={page}
        pageCount={pageCount}
        hrefFor={(n) => (n <= 1 ? "/declined" : `/declined?page=${n}`)}
        label="Pages of declined stories"
      />
    </main>
  );
}
