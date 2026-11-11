import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  return { url, anonKey };
}

/**
 * Supabase client acting as the signed-in dashboard user. Row Level Security applies,
 * so queries only ever see that user's own businesses. Use this for everything in the dashboard.
 */
export async function userClient(): Promise<SupabaseClient> {
  // Read cookies first: this marks every page using the client as per-request (never prerendered).
  const store = await cookies();
  const { url, anonKey } = publicSupabaseConfig();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only; the middleware refreshes them.
        }
      },
    },
  });
}
