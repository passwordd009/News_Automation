"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setUserRole } from "@/lib/auth/userMutations";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/permissions";

/**
 * The role dropdown for one person.
 *
 * Changes on selection rather than behind a save button: there is one field,
 * and a save button for a single select is a step that exists only to be
 * forgotten. The select reverts if the update is refused.
 */
export function RoleSelect({
  userId,
  role,
  disabled,
  disabledReason,
}: {
  userId: string;
  role: Role;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<Role>(role);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function change(next: Role) {
    const previous = value;
    setValue(next);
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await setUserRole(userId, next);
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setValue(previous);
        setError(result.error ?? "Could not change the role.");
      }
    });
  }

  return (
    <div>
      <select
        value={value}
        disabled={disabled || pending}
        title={disabled ? disabledReason : undefined}
        onChange={(event) => change(event.target.value as Role)}
        aria-label="Role"
        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm transition hover:border-accent-border disabled:cursor-not-allowed disabled:opacity-50"
      >
        {ROLES.map((option) => (
          <option key={option} value={option}>
            {ROLE_LABELS[option]}
          </option>
        ))}
      </select>

      {pending && <span className="ml-2 text-xs text-muted">Saving…</span>}
      {saved && !pending && <span className="ml-2 text-xs text-positive">Saved</span>}
      {disabled && disabledReason && (
        <p className="mt-1 text-xs text-muted">{disabledReason}</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
