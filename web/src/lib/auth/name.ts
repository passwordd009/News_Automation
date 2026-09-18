/**
 * Two inputs, one column.
 *
 * `profiles.full_name` is a single text field, and splitting it into given and
 * family names would be a migration that buys nothing — nothing in the app
 * sorts or addresses by either half. So the form asks for two and stores one.
 *
 * Empty means empty: a profile with no name holds NULL, not "", so the Users
 * table can show "—" by checking one thing rather than two.
 */
export function joinName(first: string, last: string): string | null {
  const joined = [first, last]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");

  return joined || null;
}

/**
 * Split a stored name back into two fields for editing.
 *
 * Everything before the last space is the first name, so "Ada King Lovelace"
 * round-trips rather than losing its middle. A single word is a first name
 * with no surname, which is a real way for a name to be.
 */
export function splitName(fullName: string | null): { first: string; last: string } {
  const value = (fullName ?? "").trim().replace(/\s+/g, " ");
  if (!value) return { first: "", last: "" };

  const lastSpace = value.lastIndexOf(" ");
  if (lastSpace === -1) return { first: value, last: "" };

  return { first: value.slice(0, lastSpace), last: value.slice(lastSpace + 1) };
}
