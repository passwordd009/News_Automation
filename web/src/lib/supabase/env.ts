/**
 * Resolves the Supabase connection settings.
 *
 * Supabase renamed its API keys: `anon` became `publishable`, and
 * `service_role` became `secret`. Both naming schemes are live — new projects
 * show the new names, older ones still show the old — so accept either rather
 * than making the app care which vintage a project is.
 *
 * `NEXT_PUBLIC_` variables are inlined at build time, so they must be read as
 * complete literals. `process.env[someVariable]` does not work in Next.js.
 */

export interface SupabaseEnv {
  url: string;
  key: string;
}

function firstPresent(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => value && value.trim().length > 0)?.trim();
}

export function getSupabaseEnv(): SupabaseEnv {
  const url = firstPresent(process.env.NEXT_PUBLIC_SUPABASE_URL);

  const key = firstPresent(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, // current name
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, // legacy name
  );

  if (!url || !key) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !key && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    ]
      .filter(Boolean)
      .join(" and ");

    throw new Error(
      `Supabase is not configured: ${missing} is missing from web/.env.local.\n` +
        "Copy web/.env.example, fill it in from Project Settings -> API, and " +
        "restart the dev server — NEXT_PUBLIC_ variables are read at build time.",
    );
  }

  return { url, key };
}
