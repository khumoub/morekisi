import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { token: string | null; expires: number }>();

/**
 * Access token for a shop's WhatsApp number: the shop's own token from Vault if it has one,
 * otherwise the platform token (dev, pilot and numbers on the Morekisi business account).
 */
export async function tokenFor(
  db: SupabaseClient,
  phoneNumberId: string,
  platformToken: string | undefined,
): Promise<string> {
  const hit = cache.get(phoneNumberId);
  let token: string | null;
  if (hit && hit.expires > Date.now()) {
    token = hit.token;
  } else {
    const { data, error } = await db.rpc("wa_account_token", { p_phone_number_id: phoneNumberId });
    if (error) throw new Error(`wa_account_token: ${error.message}`);
    token = (data as string | null) ?? null;
    cache.set(phoneNumberId, { token, expires: Date.now() + TTL_MS });
  }
  const resolved = token ?? platformToken;
  if (!resolved) throw new Error(`No WhatsApp access token for ${phoneNumberId} and WHATSAPP_ACCESS_TOKEN is not set`);
  return resolved;
}
