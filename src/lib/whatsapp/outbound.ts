/**
 * Outgoing WhatsApp messages. Payload builders are pure (and unit-tested) so Meta's limits
 * are enforced in one place; `sendMessage` does the HTTP call.
 */

export interface Button {
  id: string;
  title: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title?: string;
  rows: ListRow[];
}

/** Meta limits for interactive messages. */
export const LIMITS = {
  bodyText: 1024,
  text: 4096,
  buttons: 3,
  buttonTitle: 20,
  listButton: 20,
  listRows: 10,
  rowTitle: 24,
  rowDescription: 72,
  sectionTitle: 24,
  id: 200,
} as const;

export type OutboundMessage =
  | { type: "text"; text: string }
  | { type: "buttons"; body: string; buttons: Button[]; header?: string; footer?: string }
  | { type: "list"; body: string; button: string; sections: ListSection[]; header?: string; footer?: string }
  | { type: "document"; link: string; filename: string; caption?: string }
  | { type: "location_request"; body: string };

/** Shortens to fit a Meta limit, adding an ellipsis. */
export function fit(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function buildPayload(to: string, msg: OutboundMessage): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };

  switch (msg.type) {
    case "text":
      return { ...base, type: "text", text: { body: fit(msg.text, LIMITS.text), preview_url: false } };

    case "buttons": {
      if (msg.buttons.length === 0 || msg.buttons.length > LIMITS.buttons) {
        throw new Error(`WhatsApp reply buttons: 1–${LIMITS.buttons} allowed, got ${msg.buttons.length}`);
      }
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          ...(msg.header && { header: { type: "text", text: fit(msg.header, 60) } }),
          body: { text: fit(msg.body, LIMITS.bodyText) },
          ...(msg.footer && { footer: { text: fit(msg.footer, 60) } }),
          action: {
            buttons: msg.buttons.map((b) => ({
              type: "reply",
              reply: { id: b.id.slice(0, LIMITS.id), title: fit(b.title, LIMITS.buttonTitle) },
            })),
          },
        },
      };
    }

    case "list": {
      const rowCount = msg.sections.reduce((n, s) => n + s.rows.length, 0);
      if (rowCount === 0 || rowCount > LIMITS.listRows) {
        throw new Error(`WhatsApp list: 1–${LIMITS.listRows} rows allowed, got ${rowCount}`);
      }
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "list",
          ...(msg.header && { header: { type: "text", text: fit(msg.header, 60) } }),
          body: { text: fit(msg.body, LIMITS.bodyText) },
          ...(msg.footer && { footer: { text: fit(msg.footer, 60) } }),
          action: {
            button: fit(msg.button, LIMITS.listButton),
            sections: msg.sections.map((s) => ({
              ...(s.title && { title: fit(s.title, LIMITS.sectionTitle) }),
              rows: s.rows.map((r) => ({
                id: r.id.slice(0, LIMITS.id),
                title: fit(r.title, LIMITS.rowTitle),
                ...(r.description && { description: fit(r.description, LIMITS.rowDescription) }),
              })),
            })),
          },
        },
      };
    }

    case "document":
      return {
        ...base,
        type: "document",
        document: { link: msg.link, filename: msg.filename, ...(msg.caption && { caption: msg.caption }) },
      };

    case "location_request":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "location_request_message",
          body: { text: fit(msg.body, LIMITS.bodyText) },
          action: { name: "send_location" },
        },
      };
  }
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface SendConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
}

export async function sendMessage(cfg: SendConfig, to: string, msg: OutboundMessage): Promise<SendResult> {
  const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildPayload(to, msg)),
  });
  const json = (await res.json().catch(() => ({}))) as {
    messages?: { id: string }[];
    error?: { message?: string };
  };
  if (!res.ok) return { ok: false, error: json.error?.message ?? `HTTP ${res.status}` };
  return { ok: true, messageId: json.messages?.[0]?.id };
}

/** Marks a message as read (blue ticks) — makes the bot feel responsive. */
export async function markRead(cfg: SendConfig, messageId: string): Promise<void> {
  await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  }).catch(() => undefined);
}
