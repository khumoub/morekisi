import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { verifyStandardWebhook } from "@/lib/standard-webhooks";
import { loginCodeTemplate, sendMessage } from "@/lib/whatsapp/outbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Supabase Auth "Send SMS" hook: Supabase generates the login code and calls us to deliver it.
 * We send it on WhatsApp from the Morekisi platform number with an authentication template,
 * so shop owners and staff don't need SMS (and we don't pay for it).
 */
export async function POST(req: NextRequest) {
  const env = serverEnv();
  if (!env.SUPABASE_SEND_SMS_HOOK_SECRET || !env.MOREKISI_PLATFORM_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN) {
    return hookError(500, "WhatsApp login codes are not configured on the server");
  }

  const raw = await req.text();
  const ok = verifyStandardWebhook(
    raw,
    {
      id: req.headers.get("webhook-id"),
      timestamp: req.headers.get("webhook-timestamp"),
      signature: req.headers.get("webhook-signature"),
    },
    env.SUPABASE_SEND_SMS_HOOK_SECRET,
  );
  if (!ok) return hookError(401, "Invalid signature");

  let phone: string | undefined;
  let otp: string | undefined;
  try {
    const body = JSON.parse(raw) as { user?: { phone?: string }; sms?: { otp?: string } };
    phone = body.user?.phone?.replace(/^\+/, "");
    otp = body.sms?.otp;
  } catch {
    return hookError(400, "Bad JSON");
  }
  if (!phone || !otp) return hookError(400, "Missing phone or code");

  const result = await sendMessage(
    {
      phoneNumberId: env.MOREKISI_PLATFORM_PHONE_NUMBER_ID,
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      apiVersion: env.WHATSAPP_API_VERSION,
    },
    phone,
    loginCodeTemplate(env.WHATSAPP_LOGIN_TEMPLATE, env.WHATSAPP_LOGIN_TEMPLATE_LANG, otp),
  );
  if (!result.ok) {
    console.error("whatsapp-otp: send failed", result.error);
    return hookError(502, "Could not send the code on WhatsApp. Check the number is on WhatsApp and try again.");
  }
  return Response.json({});
}

/** Error shape Supabase Auth hooks expect; the message is shown to the person signing in. */
function hookError(status: number, message: string) {
  return Response.json({ error: { http_code: status, message } }, { status });
}
