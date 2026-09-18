import { describe, expect, it } from "vitest";
import { explainQueryError } from "./queries";

/**
 * These cover the translation from a PostgREST error to advice.
 *
 * The queries themselves need a database and are exercised by the SQL suite in
 * supabase/tests; what is worth pinning here is that the one failure that
 * actually happens — an unapplied migration — produces the fix rather than the
 * raw error, because the symptom (an empty queue) points nowhere near the cause.
 */
describe("explainQueryError", () => {
  it("names the migration when the generated column is missing", () => {
    const message = explainQueryError(
      'column articles.effective_date does not exist',
    );
    expect(message).toContain("20260916000001_article_effective_date.sql");
    expect(message).toContain("supabase db push");
  });

  it("recognises the column in PostgREST's other phrasing", () => {
    expect(
      explainQueryError('column "effective_date" of relation "articles" does not exist'),
    ).toContain("20260916000001");
  });

  it("points at RLS when the read is refused", () => {
    const message = explainQueryError("permission denied for table articles");
    expect(message).toContain("RLS");
    expect(message).toContain("permission denied for table articles");
  });

  it("passes anything else through rather than guessing", () => {
    expect(explainQueryError("connection reset")).toBe(
      "The database rejected the query: connection reset",
    );
  });
});
