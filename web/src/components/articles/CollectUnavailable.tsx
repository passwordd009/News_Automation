/**
 * Shown in place of the collect button when collecting is not configured.
 *
 * The button used to disappear in this situation, which is indistinguishable
 * from the feature not existing — someone looking for it has nothing to read
 * and nowhere to go. A control that explains why it cannot work is worth more
 * than a tidy empty space.
 */
export function CollectUnavailable() {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-3">
      <p className="text-sm font-medium">Collecting is not set up yet.</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        The button asks GitHub Actions to run the collector. To switch it on, set{" "}
        <code className="rounded bg-surface px-1 py-0.5">GITHUB_DISPATCH_TOKEN</code> in{" "}
        <code className="rounded bg-surface px-1 py-0.5">web/.env.local</code> — or in your
        hosting provider&apos;s environment variables — to a fine-grained GitHub token
        scoped to this repository with its <strong>Actions</strong> permission set to{" "}
        <strong>Read and write</strong>.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Environment variables are read when the server starts, so restart{" "}
        <code className="rounded bg-surface px-1 py-0.5">npm run dev</code> after adding it.
        The scheduled daily collection is unaffected either way — it does not use this token.
      </p>
    </div>
  );
}
