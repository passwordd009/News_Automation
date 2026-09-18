"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { joinName } from "@/lib/auth/name";

/**
 * Only this part needs to be a client component: it reads `?next=` and talks
 * to Supabase. The page shell around it stays on the server, so the logo and
 * heading render immediately instead of waiting for JavaScript.
 *
 * Signing up collects a name because that is the only moment it is free to
 * ask. `handle_new_user()` already copies `full_name` out of the signup's user
 * metadata, so sending it here is all that was ever missing — it is why the
 * Users table showed a column of dashes.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: joinName(firstName, lastName) } },
      });
      setBusy(false);
      if (error) return setError(error.message);
      // New accounts are content_creator by default; an admin promotes them.
      return setNotice(
        "Account created. If email confirmation is on, check your inbox, then sign in.",
      );
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError(error.message);

    router.push(nextPath);
    router.refresh();
  }

  const inputClass =
    "mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-surface p-6 shadow-sm"
    >
      {mode === "signup" && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium" htmlFor="firstName">
              First name
            </label>
            <input
              id="firstName"
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium" htmlFor="lastName">
              Last name
            </label>
            <input
              id="lastName"
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      )}

      <label className="block text-sm font-medium" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={`${inputClass} mb-4`}
      />

      <label className="block text-sm font-medium" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        type="password"
        required
        minLength={8}
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={inputClass}
      />

      {mode === "signin" && (
        <Link
          href="/forgot-password"
          className="mt-2 block text-right text-xs text-muted underline underline-offset-4 hover:text-accent"
        >
          Forgot your password?
        </Link>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-negative">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 text-sm text-positive">
          {notice}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
      >
        {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
          setNotice(null);
        }}
        className="mt-3 w-full text-center text-xs text-muted underline underline-offset-4 hover:text-accent"
      >
        {mode === "signin"
          ? "Need an account? Sign up"
          : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
