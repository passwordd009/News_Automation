"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateMyName } from "@/lib/auth/userMutations";
import { splitName } from "@/lib/auth/name";

/**
 * Your own name, as two fields over one column.
 *
 * Seeded from the stored value by splitting at the last space, so editing a
 * name that already exists does not silently rewrite it.
 */
export function AccountForm({ fullName }: { fullName: string | null }) {
  const router = useRouter();
  const initial = splitName(fullName);

  const [pending, startTransition] = useTransition();
  const [firstName, setFirstName] = useState(initial.first);
  const [lastName, setLastName] = useState(initial.last);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await updateMyName(firstName, lastName);
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error ?? "Could not save your name.");
      }
    });
  }

  const inputClass =
    "mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-lg border border-border bg-surface px-5 py-5"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium" htmlFor="firstName">
            First name
          </label>
          <input
            id="firstName"
            type="text"
            autoComplete="given-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
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
            onChange={(event) => setLastName(event.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && !pending && <span className="text-xs text-positive">Saved.</span>}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-negative">
          {error}
        </p>
      )}
    </form>
  );
}
