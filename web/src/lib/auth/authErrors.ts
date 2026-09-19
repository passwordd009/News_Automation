/**
 * Supabase's auth error codes, in terms of what to do about them.
 *
 * `otp_expired` is the one worth spelling out. It does not only mean "you were
 * slow": a recovery link is single-use, so anything that fetches it once
 * before the person clicks — a mail scanner, a link preview, a second click —
 * spends it, and the human then gets an expired link on their first real
 * attempt. Someone told merely that the link "expired" will request another
 * and hit exactly the same wall.
 */
export function describeAuthError(
  code: string | null,
  description: string | null,
): string {
  const readable = description?.replace(/\+/g, " ") ?? "";

  if (code === "otp_expired") {
    return (
      "That link had already been used, or it was more than an hour old. " +
      "Recovery links work exactly once — a mail scanner or link preview that " +
      "opens it first will use it up. Request a new one and open it directly, " +
      "in this browser."
    );
  }

  if (code === "access_denied") {
    return `The link was refused${readable ? `: ${readable}` : ""}. Request a new one.`;
  }

  return readable || "That link could not be used. Request a new one.";
}
