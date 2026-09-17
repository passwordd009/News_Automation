/**
 * The editorial week, as days.
 *
 * Weeks run Monday to Sunday in the newsroom's timezone. Days that have not
 * arrived yet cannot be opened — there is nothing to show and nothing to
 * collect, so offering the tab would only invite a confusing empty result.
 */

export const NEWSROOM_TZ = "America/New_York";

export interface WeekDay {
  /** YYYY-MM-DD, the key used in URLs and passed to the worker. */
  date: string;
  label: string;
  short: string;
  isToday: boolean;
  /** A day that has not happened yet: rendered static, never clickable. */
  isFuture: boolean;
}

/** Today's date in the newsroom's timezone, as YYYY-MM-DD. */
export function newsroomToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which sorts and compares as a string.
  return new Intl.DateTimeFormat("en-CA", { timeZone: NEWSROOM_TZ }).format(now);
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The seven days of a week starting on `startDate` (a Monday). */
export function weekDays(startDate: string, now: Date = new Date()): WeekDay[] {
  const today = newsroomToday(now);

  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(startDate, index);
    return {
      date,
      label: LABELS[index],
      short: SHORT[index],
      isToday: date === today,
      // String comparison is safe on YYYY-MM-DD.
      isFuture: date > today,
    };
  });
}

/** The day a reader should land on: today if it is in this week, else the last available one. */
export function defaultDay(days: WeekDay[]): string {
  const today = days.find((day) => day.isToday);
  if (today) return today.date;

  const past = days.filter((day) => !day.isFuture);
  return past.length ? past[past.length - 1].date : days[0].date;
}

/** The UTC instants bounding a newsroom day, for querying. */
export function dayRange(isoDate: string): { start: string; end: string } {
  // Find the timezone offset on that date rather than assuming a fixed one,
  // so the boundary stays at local midnight across a daylight-saving change.
  const noonUTC = new Date(`${isoDate}T12:00:00Z`);
  const local = new Date(noonUTC.toLocaleString("en-US", { timeZone: NEWSROOM_TZ }));
  const offsetMs = noonUTC.getTime() - local.getTime();

  const start = new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + offsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start: start.toISOString(), end: end.toISOString() };
}

export function isValidDay(value: string | undefined, days: WeekDay[]): value is string {
  if (!value) return false;
  const day = days.find((d) => d.date === value);
  return Boolean(day && !day.isFuture);
}
