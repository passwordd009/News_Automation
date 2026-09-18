import Link from "next/link";

/**
 * Numbered page links.
 *
 * Every page is a real link with the page number in the URL, so a page can be
 * bookmarked, opened in a new tab, and reached with the back button — the same
 * reason the days themselves are routes rather than state.
 *
 * With many pages the middle is elided rather than wrapping across three lines:
 * first, last, and a window around the current page.
 */
export function Pagination({
  page,
  pageCount,
  hrefFor,
  label = "Pages",
}: {
  page: number;
  pageCount: number;
  /** Builds the URL for a page number, so this works on any route. */
  hrefFor: (page: number) => string;
  label?: string;
}) {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label={label} className="mt-10 flex items-center justify-center gap-1">
      <Step
        href={hrefFor(page - 1)}
        disabled={page <= 1}
        label="Previous page"
        glyph="←"
      />

      {pageNumbers(page, pageCount).map((entry, index) =>
        entry === "gap" ? (
          <span
            key={`gap-${index}`}
            aria-hidden="true"
            className="px-1 text-sm text-muted"
          >
            …
          </span>
        ) : (
          <Link
            key={entry}
            href={hrefFor(entry)}
            aria-current={entry === page ? "page" : undefined}
            aria-label={`Page ${entry}`}
            className={[
              "min-w-9 rounded-md px-3 py-1.5 text-center text-sm tabular-nums transition",
              entry === page
                ? "bg-accent font-semibold text-white"
                : "border border-border text-foreground hover:border-accent-border hover:text-accent-strong",
            ].join(" ")}
          >
            {entry}
          </Link>
        ),
      )}

      <Step href={hrefFor(page + 1)} disabled={page >= pageCount} label="Next page" glyph="→" />
    </nav>
  );
}

function Step({
  href,
  disabled,
  label,
  glyph,
}: {
  href: string;
  disabled: boolean;
  label: string;
  glyph: string;
}) {
  // At either end there is nowhere to go, so this renders as text rather than
  // a link that would quietly reload the same page.
  if (disabled) {
    return (
      <span
        aria-hidden="true"
        className="min-w-9 cursor-not-allowed px-3 py-1.5 text-center text-sm text-muted/40 select-none"
      >
        {glyph}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className="min-w-9 rounded-md border border-border px-3 py-1.5 text-center text-sm transition hover:border-accent-border hover:text-accent-strong"
    >
      {glyph}
    </Link>
  );
}

/**
 * Which page numbers to show: always the first and last, plus a window around
 * the current one, with gaps marked.
 */
export function pageNumbers(page: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const shown = new Set<number>([1, pageCount, page]);
  if (page - 1 > 1) shown.add(page - 1);
  if (page + 1 < pageCount) shown.add(page + 1);
  // Keep the row a stable width near the ends, where the window is one-sided.
  if (page <= 3) [2, 3, 4].forEach((n) => shown.add(n));
  if (page >= pageCount - 2) {
    [pageCount - 3, pageCount - 2, pageCount - 1].forEach((n) => shown.add(n));
  }

  const sorted = [...shown].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);

  const out: (number | "gap")[] = [];
  let previous = 0;
  for (const number of sorted) {
    const missing = previous ? number - previous - 1 : 0;
    // An ellipsis standing for one page is wider than the page number it
    // replaced, and hides something reachable in a click. Show it instead.
    if (missing === 1) out.push(previous + 1);
    else if (missing > 1) out.push("gap");
    out.push(number);
    previous = number;
  }
  return out;
}

/** Clamp a `?page=` value to something that exists. */
export function resolvePage(raw: string | undefined, pageCount: number): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, Math.max(pageCount, 1));
}
