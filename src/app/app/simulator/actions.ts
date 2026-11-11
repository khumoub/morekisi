"use server";
import { getProvider } from "@/lib/ai";
import { getSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { supabaseRepo } from "@/lib/db/supabase-repo";
import { handleInbound } from "@/lib/engine/handle";
import { toWaId } from "@/lib/phone";
import { simulatorEnabled } from "@/lib/simulator";
import type { InboundContent } from "@/lib/whatsapp/inbound";
import type { OutboundMessage } from "@/lib/whatsapp/outbound";

/**
 * Chat simulator: sends messages through the real WhatsApp engine and database, but delivers
 * replies to this page instead of to Meta. Only available when MOREKISI_SIMULATOR=true
 * (set by docker-compose.yml for local development).
 */

export type SimSender = "me" | "customer";

/** Fixed pretend customer number, one per shop. */
const TEST_CUSTOMER = "26770000099";

export interface SimMessage {
  id: number;
  direction: "in" | "out";
  text: string;
  payload: OutboundMessage | null;
  at: string;
}

async function context(as: SimSender) {
  if (!simulatorEnabled()) throw new Error("The chat simulator is turned off (MOREKISI_SIMULATOR).");
  const session = await getSession();
  const db = adminClient();
  const { data: account } = await db
    .from("wa_accounts")
    .select("phone_number_id")
    .eq("business_id", session.current.businessId)
    .eq("active", true)
    .maybeSingle();
  if (!account) throw new Error("Connect a WhatsApp number (any test values) under WhatsApp first.");
  const { data: me } = await db.from("business_users").select("phone").eq("id", session.current.userId).single();
  const waId = as === "me" ? toWaId(me!.phone) : TEST_CUSTOMER;
  return { db, session, phoneNumberId: account.phone_number_id as string, waId };
}

export async function simSend(as: SimSender, content: InboundContent): Promise<{ error?: string }> {
  try {
    const { db, phoneNumberId, waId } = await context(as);
    await handleInbound(
      {
        repo: supabaseRepo(db),
        ai: getProvider(),
        messengerFor: () => ({
          send: async () => ({ ok: true, messageId: `sim-${crypto.randomUUID()}` }),
          sendFile: async (_to, file) => ({
            ok: true,
            messageId: `sim-${crypto.randomUUID()}`,
            url: `data:${file.mimeType};base64,${file.data.toString("base64")}`,
          }),
        }),
      },
      {
        phoneNumberId,
        from: waId,
        profileName: as === "customer" ? "Test Customer" : undefined,
        messageId: `sim-${crypto.randomUUID()}`,
        timestamp: new Date(),
        content,
        raw: { simulated: true, content },
      },
    );
    return {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function simHistory(as: SimSender): Promise<{ messages: SimMessage[]; error?: string }> {
  try {
    const { db, session, waId } = await context(as);
    const { data: conv } = await db
      .from("conversations")
      .select("id")
      .eq("business_id", session.current.businessId)
      .eq("wa_id", waId)
      .maybeSingle();
    if (!conv) return { messages: [] };
    const { data, error } = await db
      .from("wa_messages")
      .select("id, direction, body, payload, created_at")
      .eq("conversation_id", conv.id)
      .order("created_at")
      .order("id")
      .limit(200);
    if (error) throw new Error(error.message);
    return {
      messages: data.map((m) => ({
        id: m.id,
        direction: m.direction,
        text: m.body ?? "",
        payload: m.direction === "out" ? (m.payload as OutboundMessage) : null,
        at: m.created_at,
      })),
    };
  } catch (err) {
    return { messages: [], error: (err as Error).message };
  }
}

/** Clears the simulated conversation: messages, bot state, person-handover and any pending action. */
export async function simReset(as: SimSender): Promise<void> {
  const { db, session, waId } = await context(as);
  const { data: conv } = await db
    .from("conversations")
    .select("id")
    .eq("business_id", session.current.businessId)
    .eq("wa_id", waId)
    .maybeSingle();
  if (conv) {
    await db.from("wa_messages").delete().eq("conversation_id", conv.id);
    await db.from("conversations").update({ mode: "bot", state: {}, unread_count: 0 }).eq("id", conv.id);
  }
  if (as === "me") await db.from("pending_actions").delete().eq("user_id", session.current.userId);
}
