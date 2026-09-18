"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Sends a recovery link.
 *
 * The reply is the same whether or not the address has an account, and the
 * error from Supabase is deliberately ignored: telling a stranger which
 * addresses are registered is a slow leak of your editors' identities, and the
 * person who genuinely owns the address learns nothing extra from it either.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      // Supabase checks this against the project's redirect allow-list, so the
      // deployed origin has to be listed there or the link is refused.
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    setBusy(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <p className="text-sm font-medium">Check your inbox.</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          If <span className="text-foreground">{email}</span> has an account, a link
          to set a new password is on its way. It expires after an hour.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Nothing arriving? Check spam, then ask an admin — a project sends only a
          couple of these an hour until custom email delivery is configured.
        </p>
        <Link
          href="/login"
          className="mt-5 block text-center text-sm text-muted underline underline-offset-4 hover:text-accent"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-surface p-6 shadow-sm"
    >
      <label className="block text-sm font-medium" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        autoFocus
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />

      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
      >
        {busy ? "Sending…" : "Send a reset link"}
      </button>

      <Link
        href="/login"
        className="mt-3 block text-center text-xs text-muted underline underline-offset-4 hover:text-accent"
      >
        Back to sign in
      </Link>
    </form>
  );
}
