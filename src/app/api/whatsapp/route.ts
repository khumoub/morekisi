import { after, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { adminClient } from "@/lib/db/server";
import { supabaseRepo } from "@/lib/db/supabase-repo";
import { handleInbound } from "@/lib/engine/handle";
import { parseWebhook } from "@/lib/whatsapp/inbound";
import { markRead, sendMessage, uploadMedia, type SendConfig } from "@/lib/whatsapp/outbound";
import { getProvider } from "@/lib/ai";
import type { Messenger } from "@/lib/engine/types";
import { verifySignature } from "@/lib/whatsapp/signature";
import { tokenFor } from "@/lib/whatsapp/tokens";

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

    const configFor = async (phoneNumberId: string): Promise<SendConfig> => ({
      phoneNumberId,
      accessToken: await tokenFor(db, phoneNumberId, env.WHATSAPP_ACCESS_TOKEN),
      apiVersion: env.WHATSAPP_API_VERSION,
    });

    const messengerFor = (account: { phoneNumberId: string }): Messenger => ({
      send: async (to, msg) => sendMessage(await configFor(account.phoneNumberId), to, msg),
      sendFile: async (to, file, caption) => {
        const cfg = await configFor(account.phoneNumberId);
        const uploaded = await uploadMedia(cfg, file);
        if (!uploaded.ok) {
          console.error("whatsapp: media upload failed", uploaded.error);
          return { ok: false };
        }
        return sendMessage(cfg, to, { type: "document", id: uploaded.id, filename: file.filename, caption });
      },
    });

    for (const message of messages) {
      try {
        const outcome = await handleInbound({ repo, messengerFor, ai: getProvider() }, message);
        if (outcome !== "unknown_number" && outcome !== "duplicate") {
          await markRead(await configFor(message.phoneNumberId), message.messageId);
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
