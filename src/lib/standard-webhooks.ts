import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Standard Webhooks signature (https://www.standardwebhooks.com), as used by
 * Supabase Auth hooks. Secret format from the Supabase dashboard: "v1,whsec_<base64>".
 */
export function verifyStandardWebhook(
  body: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  now: Date = new Date(),
  toleranceSeconds = 300,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > toleranceSeconds) return false;

  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();

  // The header may hold several space-separated signatures ("v1,<base64> v1,<base64>").
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const received = Buffer.from(sig, "base64");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}
