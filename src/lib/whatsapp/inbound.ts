/**
 * Turns Meta's nested webhook payload into flat, typed messages the rest of the app works with.
 * Payload reference: entry[].changes[].value.{metadata, contacts, messages, statuses}
 */

export type InboundContent =
  | { kind: "text"; text: string }
  | { kind: "button"; id: string; title: string } // reply button tapped
  | { kind: "list"; id: string; title: string } // list row chosen
  | { kind: "location"; lat: number; lng: number; name?: string; address?: string }
  | { kind: "audio"; mediaId: string } // voice note (Phase 2: speech-to-text)
  | { kind: "image"; mediaId: string; caption?: string }
  | { kind: "document"; mediaId: string; filename?: string }
  | { kind: "flow"; responseJson: string } // WhatsApp Flow submitted
  | { kind: "unsupported"; type: string };

export interface InboundMessage {
  /** The shop's number that received the message — used to find the business. */
  phoneNumberId: string;
  /** Sender's WhatsApp id, digits only. */
  from: string;
  /** Sender's WhatsApp profile name, if shared. */
  profileName?: string;
  messageId: string;
  timestamp: Date;
  content: InboundContent;
  raw: unknown;
}

export interface StatusUpdate {
  phoneNumberId: string;
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  recipient: string;
}

// Loose shapes of the bits of Meta's payload we read.
interface MetaMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
    nfm_reply?: { response_json: string };
  };
  button?: { payload: string; text: string }; // template quick-reply button
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  audio?: { id: string };
  image?: { id: string; caption?: string };
  document?: { id: string; filename?: string };
}

interface MetaValue {
  metadata?: { phone_number_id: string };
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: MetaMessage[];
  statuses?: { id: string; status: StatusUpdate["status"]; recipient_id: string }[];
}

interface MetaWebhook {
  object?: string;
  entry?: { changes?: { field?: string; value?: MetaValue }[] }[];
}

function toContent(m: MetaMessage): InboundContent {
  switch (m.type) {
    case "text":
      return { kind: "text", text: m.text?.body ?? "" };
    case "interactive": {
      const i = m.interactive;
      if (i?.button_reply) return { kind: "button", id: i.button_reply.id, title: i.button_reply.title };
      if (i?.list_reply) return { kind: "list", id: i.list_reply.id, title: i.list_reply.title };
      if (i?.nfm_reply) return { kind: "flow", responseJson: i.nfm_reply.response_json };
      return { kind: "unsupported", type: `interactive:${i?.type ?? "?"}` };
    }
    case "button":
      return { kind: "button", id: m.button?.payload ?? "", title: m.button?.text ?? "" };
    case "location":
      return {
        kind: "location",
        lat: m.location!.latitude,
        lng: m.location!.longitude,
        name: m.location?.name,
        address: m.location?.address,
      };
    case "audio":
      return { kind: "audio", mediaId: m.audio!.id };
    case "image":
      return { kind: "image", mediaId: m.image!.id, caption: m.image?.caption };
    case "document":
      return { kind: "document", mediaId: m.document!.id, filename: m.document?.filename };
    default:
      return { kind: "unsupported", type: m.type };
  }
}

export function parseWebhook(body: unknown): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  const payload = body as MetaWebhook;
  if (payload?.object !== "whatsapp_business_account") return { messages, statuses };

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (change.field !== "messages" || !value || !phoneNumberId) continue;

      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages ?? []) {
        messages.push({
          phoneNumberId,
          from: m.from,
          profileName: names.get(m.from),
          messageId: m.id,
          timestamp: new Date(Number(m.timestamp) * 1000),
          content: toContent(m),
          raw: m,
        });
      }
      for (const s of value.statuses ?? []) {
        statuses.push({ phoneNumberId, messageId: s.id, status: s.status, recipient: s.recipient_id });
      }
    }
  }
  return { messages, statuses };
}

/** Plain text of a message, for logging and for the AI. */
export function contentText(c: InboundContent): string {
  switch (c.kind) {
    case "text":
      return c.text;
    case "button":
    case "list":
      return c.title;
    case "location":
      return `[location ${c.lat},${c.lng}${c.address ? ` ${c.address}` : ""}]`;
    case "image":
      return c.caption ? `[image] ${c.caption}` : "[image]";
    case "document":
      return `[document ${c.filename ?? ""}]`.trim();
    case "audio":
      return "[voice note]";
    case "flow":
      return "[form submitted]";
    default:
      return `[${c.type}]`;
  }
}
