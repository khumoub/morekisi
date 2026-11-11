import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStandardWebhook } from "@/lib/standard-webhooks";
import { buildPayload, loginCodeTemplate } from "@/lib/whatsapp/outbound";

const rawKey = Buffer.from("super-secret-key-material-32byte");
const secret = `v1,whsec_${rawKey.toString("base64")}`;
const body = '{"user":{"phone":"26771000009"},"sms":{"otp":"123456"}}';
const now = new Date("2026-11-11T10:00:00Z");
const ts = String(Math.floor(now.getTime() / 1000));
const sign = (id: string, t: string, b: string) =>
  "v1," + createHmac("sha256", rawKey).update(`${id}.${t}.${b}`).digest("base64");

describe("Supabase auth hook signature (Standard Webhooks)", () => {
  it("accepts a valid signature", () => {
    expect(verifyStandardWebhook(body, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, secret, now)).toBe(true);
  });
  it("accepts when one of several signatures matches (key rotation)", () => {
    const sig = `v1,AAAA ${sign("msg_1", ts, body)}`;
    expect(verifyStandardWebhook(body, { id: "msg_1", timestamp: ts, signature: sig }, secret, now)).toBe(true);
  });
  it("rejects a changed body, id or old timestamp", () => {
    const sig = sign("msg_1", ts, body);
    expect(verifyStandardWebhook(body.replace("123456", "000000"), { id: "msg_1", timestamp: ts, signature: sig }, secret, now)).toBe(false);
    expect(verifyStandardWebhook(body, { id: "msg_2", timestamp: ts, signature: sig }, secret, now)).toBe(false);
    const old = String(Number(ts) - 600);
    expect(verifyStandardWebhook(body, { id: "msg_1", timestamp: old, signature: sign("msg_1", old, body) }, secret, now)).toBe(false);
  });
  it("rejects missing headers", () => {
    expect(verifyStandardWebhook(body, { id: null, timestamp: ts, signature: "v1,x" }, secret, now)).toBe(false);
  });
});

describe("login code template", () => {
  it("puts the code in the body and the copy-code button", () => {
    const p = buildPayload("26771000009", loginCodeTemplate("morekisi_login_code", "en", "123456")) as {
      type: string;
      template: { name: string; language: { code: string }; components: { type: string; parameters: { text: string }[] }[] };
    };
    expect(p.type).toBe("template");
    expect(p.template.name).toBe("morekisi_login_code");
    expect(p.template.language.code).toBe("en");
    expect(p.template.components.map((c) => [c.type, c.parameters[0].text])).toEqual([
      ["body", "123456"],
      ["button", "123456"],
    ]);
  });
});
