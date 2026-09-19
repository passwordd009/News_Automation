/**
 * The 72-hour window on a signup request.
 *
 * Expiry is computed from `requested_at` rather than stored, so the deadline
 * holds whether or not anything has run since. There is no job to fail.
 */

export const APPROVAL_WINDOW_HOURS = 72;

const HOUR_MS = 60 * 60 * 1000;

export type RequestState = "waiting" | "expired";

export function expiresAt(requestedAt: string): Date {
  return new Date(Date.parse(requestedAt) + APPROVAL_WINDOW_HOURS * HOUR_MS);
}

export function requestState(requestedAt: string, now = new Date()): RequestState {
  return now.getTime() < expiresAt(requestedAt).getTime() ? "waiting" : "expired";
}

/**
 * How long is left, for someone deciding whether to act now.
 *
 * Deliberately coarse: hours until the last few, then minutes. "2 days left"
 * and "47 hours left" carry the same information, and the first is the one a
 * person reads without doing arithmetic.
 */
export function timeLeft(requestedAt: string, now = new Date()): string {
  const remaining = expiresAt(requestedAt).getTime() - now.getTime();
  if (remaining <= 0) return "expired";

  const hours = Math.floor(remaining / HOUR_MS);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} left`;
  }
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"} left`;

  const minutes = Math.max(1, Math.floor(remaining / 60_000));
  return `${minutes} minute${minutes === 1 ? "" : "s"} left`;
}
