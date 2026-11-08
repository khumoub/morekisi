import { after, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { adminClient } from "@/lib/db/server";
import { supabaseRepo } from "@/lib/db/supabase-repo";
import { handleInbound } from "@/lib/engine/handle";
import { parseWebhook } from "@/lib/whatsapp/inbound";
import { markRead, sendMessage, type SendConfig } from "@/lib/whatsapp/outbound";
import { verifySignature } from "@/lib/whatsapp/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Meta calls this once when the webhook is configured, to check we own the URL. */
export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const env = serverEnv();
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Every message and delivery status for every connected shop number arrives here.
 * We verify the signature, answer 200 straight away (Meta retries slow webhooks),
 * and do the actual work after the response with `after()`.
 */
export async function POST(req: NextRequest) {
  const env = serverEnv();
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), env.WHATSAPP_APP_SECRET)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const { messages, statuses } = parseWebhook(body);

  after(async () => {
    const db = adminClient();
    const repo = supabaseRepo(db);

    const configFor = (account: { phoneNumberId: string; tokenSecretId: string | null }): SendConfig => {
      // TODO(week 2): read per-shop tokens from Supabase Vault (account.tokenSecretId) for Embedded Signup.
      if (!env.WHATSAPP_ACCESS_TOKEN) throw new Error("WHATSAPP_ACCESS_TOKEN is not set");
      return {
        phoneNumberId: account.phoneNumberId,
        accessToken: env.WHATSAPP_ACCESS_TOKEN,
        apiVersion: env.WHATSAPP_API_VERSION,
      };
    };

    for (const message of messages) {
      try {
        const outcome = await handleInbound(
          repo,
          (account) => (to, msg) => sendMessage(configFor(account), to, msg),
          message,
        );
        if (outcome !== "unknown_number" && outcome !== "duplicate") {
          await markRead(configFor({ phoneNumberId: message.phoneNumberId, tokenSecretId: null }), message.messageId);
        }
      } catch (err) {
        console.error("whatsapp: failed to handle message", message.messageId, err);
      }
    }

    for (const s of statuses) {
      await db.from("wa_messages").update({ status: s.status }).eq("wa_message_id", s.messageId);
    }
  });

  return new Response("OK", { status: 200 });
}
