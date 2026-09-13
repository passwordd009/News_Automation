/** Shared formatting. Dates from Postgres are plain YYYY-MM-DD strings. */

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const DAY_NO_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/** Parsed as UTC so a date-only value never slips a day in a western timezone. */
function asUTC(value: string): Date {
  return new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
}

export function formatDate(value: string | null): string {
  if (!value) return "Date unknown";
  return DAY.format(asUTC(value));
}

/** "September 7 – September 13, 2026" */
export function formatPeriodRange(start: string, end: string): string {
  const endDate = asUTC(end);
  return `${DAY_NO_YEAR.format(asUTC(start))} – ${DAY_NO_YEAR.format(endDate)}, ${endDate.getUTCFullYear()}`;
}

export function formatScore(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}
