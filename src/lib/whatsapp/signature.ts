import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta signs each webhook POST with HMAC-SHA256 of the raw body using the app secret,
 * sent as `X-Hub-Signature-256: sha256=<hex>`. Must be checked against the *raw* body.
 */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
