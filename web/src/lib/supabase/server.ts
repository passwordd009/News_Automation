import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Supabase for Server Components, Route Handlers and Server Actions.
 *
 * Also the anon key: the session comes from the request's cookies, so RLS
 * still decides what this user can read and write.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = getSupabaseEnv();

  return createServerClient(
    env.url,
    env.key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot set cookies. Harmless: the middleware
            // refreshes the session on every request.
          }
        },
      },
    },
  );
}
