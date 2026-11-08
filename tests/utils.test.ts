import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatPula, parsePula } from "@/lib/money";
import { toE164, toWaId } from "@/lib/phone";
import { verifySignature } from "@/lib/whatsapp/signature";
import { buildPayload, fit } from "@/lib/whatsapp/outbound";
import { parseWebhook } from "@/lib/whatsapp/inbound";

describe("money", () => {
  it("formats thebe as Pula", () => {
    expect(formatPula(250000)).toBe("P2,500.00");
    expect(formatPula(30702)).toBe("P307.02");
    expect(formatPula(-10000)).toBe("-P100.00");
    expect(formatPula(0)).toBe("P0.00");
  });
  it("parses what people type", () => {
    expect(parsePula("P2,500")).toBe(250000);
    expect(parsePula("p 95")).toBe(9500);
    expect(parsePula("2500.50")).toBe(250050);
    expect(parsePula("BWP 1 200")).toBe(120000);
    expect(parsePula("1.2k")).toBe(120000);
    expect(parsePula("500 pula")).toBe(50000);
    expect(parsePula("cement")).toBeNull();
    expect(parsePula("1.234")).toBeNull();
  });
});

describe("phone", () => {
  it("normalises Botswana numbers", () => {
    expect(toE164("71 234 567")).toBe("+26771234567");
    expect(toE164("+267 71234567")).toBe("+26771234567");
    expect(toE164("0026771234567")).toBe("+26771234567");
    expect(toE164("26771234567")).toBe("+26771234567");
    expect(toE164("123")).toBeNull();
    expect(toWaId("+26771234567")).toBe("26771234567");
  });
});

describe("webhook signature", () => {
  const secret = "app-secret";
  const body = '{"object":"whatsapp_business_account"}';
  const good = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  it("accepts a correct signature", () => expect(verifySignature(body, good, secret)).toBe(true));
  it("rejects a tampered body", () => expect(verifySignature(body + " ", good, secret)).toBe(false));
  it("rejects missing or malformed headers", () => {
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "sha1=abc", secret)).toBe(false);
    expect(verifySignature(body, "sha256=zz", secret)).toBe(false);
  });
});

describe("outbound payloads", () => {
  it("enforces Meta button limits", () => {
    expect(() =>
      buildPayload("267", {
        type: "buttons",
        body: "x",
        buttons: [1, 2, 3, 4].map((i) => ({ id: `${i}`, title: `${i}` })),
      }),
    ).toThrow(/1–3/);
    const p = buildPayload("267", {
      type: "buttons",
      body: "x",
      buttons: [{ id: "a", title: "A very long button title here" }],
    }) as { interactive: { action: { buttons: { reply: { title: string } }[] } } };
    expect(p.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);
  });
  it("enforces list row limits", () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ id: `${i}`, title: `${i}` }));
    expect(() => buildPayload("267", { type: "list", body: "x", button: "Go", sections: [{ rows }] })).toThrow();
  });
  it("fit() adds an ellipsis", () => expect(fit("abcdefghij", 5)).toBe("abcd…"));
});

describe("webhook parsing", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "PNID" },
              contacts: [{ wa_id: "26772000002", profile: { name: "Tumelo" } }],
              messages: [
                { from: "26772000002", id: "m1", timestamp: "1730000000", type: "text", text: { body: "hi" } },
                {
                  from: "26772000002",
                  id: "m2",
                  timestamp: "1730000001",
                  type: "interactive",
                  interactive: { type: "button_reply", button_reply: { id: "store:browse", title: "Browse products" } },
                },
                {
                  from: "26772000002",
                  id: "m3",
                  timestamp: "1730000002",
                  type: "location",
                  location: { latitude: -24.65, longitude: 25.91 },
                },
              ],
              statuses: [{ id: "out1", status: "read", recipient_id: "26772000002" }],
            },
          },
        ],
      },
    ],
  };
  it("flattens messages and statuses", () => {
    const { messages, statuses } = parseWebhook(payload);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ phoneNumberId: "PNID", from: "26772000002", profileName: "Tumelo" });
    expect(messages[0].content).toEqual({ kind: "text", text: "hi" });
    expect(messages[1].content).toEqual({ kind: "button", id: "store:browse", title: "Browse products" });
    expect(messages[2].content).toMatchObject({ kind: "location", lat: -24.65 });
    expect(statuses).toEqual([{ phoneNumberId: "PNID", messageId: "out1", status: "read", recipient: "26772000002" }]);
  });
  it("ignores other webhook objects", () => {
    expect(parseWebhook({ object: "page" }).messages).toHaveLength(0);
  });
});
