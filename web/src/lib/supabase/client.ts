"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Supabase for the browser, using the anon key.
 *
 * Every request from here carries the signed-in user's JWT, so RLS applies
 * exactly as written. The service-role key must never reach this file — it
 * bypasses RLS, and anything in the browser bundle is public.
 */
export function createClient() {
  const env = getSupabaseEnv();
  return createBrowserClient(
    env.url,
    env.key,
  );
}
