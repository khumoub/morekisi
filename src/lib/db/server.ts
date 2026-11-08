import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

let admin: SupabaseClient | undefined;

/**
 * Service-role client: bypasses RLS. Use only in server code (webhooks, cron) where
 * the business id comes from a verified source, such as the shop's WhatsApp phone_number_id.
 */
export function adminClient(): SupabaseClient {
  if (!admin) {
    const env = serverEnv();
    admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
