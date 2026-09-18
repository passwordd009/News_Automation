"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Sets a new password, using the session the recovery link established.
 *
 * Reaching this page without that session means the link expired, was already
 * used, or was opened in a different browser. That is not an error to hide
 * behind a redirect to sign-in — where it would look like a wrong password —
 * so it says what happened and offers another link.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(searchParams.get("error"));

  useEffect(() => {
    // getUser() revalidates with Supabase rather than trusting the cookie,
    // which is the same rule the proxy follows.
    createClient()
      .auth.getUser()
      .then(({ data }) => setHasSession(Boolean(data.user)))
      .finally(() => setChecking(false));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      return setError("Those two passwords are not the same.");
    }

    setBusy(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    setBusy(false);

    if (updateError) return setError(updateError.message);

    router.push("/dashboard");
    router.refresh();
  }

  if (checking) {
    return (
      <div
        aria-hidden
        className="rounded-lg border border-border bg-surface p-6 shadow-sm"
      >
        <div className="mb-4 h-4 w-28 rounded bg-border" />
        <div className="h-9 w-full rounded-md bg-border/60" />
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <p className="text-sm font-medium text-negative">That link no longer works.</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {error
            ? error
            : "Recovery links expire after an hour and can only be used once. Opening one in a different browser from the one that asked for it will not work either."}
        </p>
        <Link
          href="/forgot-password"
          className="mt-5 block w-full rounded-md bg-accent px-4 py-2 text-center text-sm font-medium text-white transition hover:bg-accent-strong"
        >
          Send another link
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-surface p-6 shadow-sm"
    >
      <label className="block text-sm font-medium" htmlFor="password">
        New password
      </label>
      <input
        id="password"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        autoFocus
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="mt-1.5 mb-4 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />

      <label className="block text-sm font-medium" htmlFor="confirm">
        Again, to be sure
      </label>
      <input
        id="confirm"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />

      {error && (
        <p role="alert" className="mt-4 text-sm text-negative">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
      >
        {busy ? "Saving…" : "Set password and sign in"}
      </button>
    </form>
  );
}
