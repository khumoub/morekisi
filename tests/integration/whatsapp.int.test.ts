/**
 * End-to-end: WhatsApp messages → real engine → real Supabase (local Docker stack) → database.
 * Only the AI is scripted (FakeAI) and WhatsApp sending is captured instead of calling Meta.
 *
 *   docker compose up -d && npm run test:integration
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { supabaseRepo } from "@/lib/db/supabase-repo";
import { handleInbound } from "@/lib/engine/handle";
import type { OutboundMessage } from "@/lib/whatsapp/outbound";
import { FakeAI } from "../fake-shop";

const env = Object.fromEntries(
  readFileSync("docker/local.env", "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const URL_ = process.env.SUPABASE_TEST_URL ?? "http://localhost:8000";
const db = createClient(URL_, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const repo = supabaseRepo(db);

const SHOP_NUMBER = "100000000000001"; // seeded wa_accounts row
const STAFF = "26771234568"; // Kago Sello (staff)
const OWNER = "26771234567"; // Neo Molefe (owner)
const CUSTOMER = `2677${Date.now() % 10_000_000}`.padEnd(11, "0"); // a new customer each run
const run = Date.now();

const sent: { to: string; msg: OutboundMessage }[] = [];
const files: { filename: string; data: Buffer }[] = [];
let n = 0;

async function say(from: string, content: string | { kind: "button" | "list"; id: string; title: string }, ai: FakeAI | null = null) {
  return handleInbound(
    {
      repo,
      ai,
      messengerFor: () => ({
        send: async (to, msg) => (sent.push({ to, msg }), { ok: true, messageId: `out-${run}-${++n}` }),
        sendFile: async (_to, file) => (files.push({ filename: file.filename, data: file.data }), { ok: true, messageId: `file-${run}-${++n}` }),
      }),
    },
    {
      phoneNumberId: SHOP_NUMBER,
      from,
      profileName: "Integration Test",
      messageId: `in-${run}-${++n}`,
      timestamp: new Date(),
      content: typeof content === "string" ? { kind: "text", text: content } : content,
      raw: {},
    },
  );
}
const lastText = () => {
  const m = sent.at(-1)!.msg;
  return m.type === "text" ? m.text : "body" in m ? m.body : "";
};
const onHand = async (sku: string) => {
  const { data: p } = await db.from("products").select("id").eq("sku", sku).single();
  const { data: s } = await db.from("product_stock").select("on_hand").eq("product_id", p!.id).single();
  return Number(s!.on_hand);
};

beforeAll(async () => {
  const { error } = await db.from("businesses").select("id").limit(1);
  if (error) throw new Error(`Local Supabase not reachable at ${URL_} — run "docker compose up -d" first (${error.message})`);
});

describe("WhatsApp → engine → local Supabase", () => {
  it("routes staff to the back office and answers stock from the real database", async () => {
    expect(await say(STAFF, "stock rebar y12")).toBe("office");
    expect(lastText()).toMatch(/\*Rebar Y12 6m\*: \d+ each/);
  });

  it("records a credit sale with confirmation, sends a real invoice PDF, and updates stock and balance", async () => {
    const msg = `sold 2 cement 42.5 and 1 rebar to tlotlo on credit (${run})`;
    const ai = new FakeAI({
      [msg]: {
        intent: "record_sale",
        items: [
          { product: "Cement 42.5N 50kg", qty: 2, unit_price: null },
          { product: "Rebar Y12 6m", qty: 1, unit_price: null },
        ],
        customer: "tlotlo",
        payment_method: "credit",
      },
    });
    const cementBefore = await onHand("CEM425");
    const { data: prices } = await db.from("products").select("sku, sell_price").in("sku", ["CEM425", "Y12"]);
    const price = (sku: string) => Number(prices!.find((p) => p.sku === sku)!.sell_price);
    const total = 2 * price("CEM425") + price("Y12");
    const pula = `P${(total / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
    const { data: balBefore } = await db.from("customer_balances").select("balance").eq("name", "Tlotlo Ntsima").single();

    await say(STAFF, msg, ai);
    expect(lastText()).toContain("🧾 *Sale — Tlotlo Ntsima*");
    expect(lastText()).toContain("2 × Cement 42.5N 50kg");
    const { data: pending } = await db.from("pending_actions").select("kind").eq("user_id", "d1000000-0000-0000-0000-000000000002");
    expect(pending).toEqual([{ kind: "sale" }]);

    await say(STAFF, { kind: "button", id: "pa:yes", title: "✅ Confirm" }, ai);
    expect(lastText()).toContain(`: ${pula}.`);
    expect(lastText()).toMatch(/✅ Saved as \*INV-\d{5}\*/);
    expect(files.at(-1)!.filename).toMatch(/^INV-\d{5}\.pdf$/);
    expect(files.at(-1)!.data.subarray(0, 5).toString()).toBe("%PDF-");

    expect(await onHand("CEM425")).toBe(cementBefore - 2);
    const { data: balAfter } = await db.from("customer_balances").select("balance").eq("name", "Tlotlo Ntsima").single();
    expect(Number(balAfter!.balance)).toBe(Number(balBefore!.balance) + total);
    const { count } = await db.from("pending_actions").select("*", { count: "exact", head: true }).eq("user_id", "d1000000-0000-0000-0000-000000000002");
    expect(count).toBe(0);
  });

  it("records a payment and receives stock", async () => {
    const pay = `tlotlo paid 100 orange money (${run})`;
    const receive = `received 10 nails (${run})`;
    const ai = new FakeAI({
      [pay]: { intent: "record_payment", customer: "tlotlo", amount: 100, payment_method: "orange_money" },
      [receive]: { intent: "stock_in", items: [{ product: "Nails 75mm 1kg", qty: 10, unit_price: 21 }], supplier: "Test Supplier" },
    });
    await say(STAFF, pay, ai);
    await say(STAFF, "yes", ai);
    expect(lastText()).toMatch(/✅ Payment saved \(\*RCPT-\d{5}\*\): P100\.00 from Tlotlo Ntsima/);

    const before = await onHand("NAIL75");
    await say(STAFF, receive, ai);
    await say(STAFF, "ok", ai);
    expect(await onHand("NAIL75")).toBe(before + 10);
    const { data: cost } = await db.from("products").select("cost_price").eq("sku", "NAIL75").single();
    expect(Number(cost!.cost_price)).toBe(2100);
  });

  it("reports sales with profit for the owner only", async () => {
    const ai = new FakeAI({ "sales today": { intent: "report", period: "today" } });
    await say(OWNER, "sales today", ai);
    expect(lastText()).toContain("Gross profit");
    await say(STAFF, "sales today", ai);
    expect(lastText()).not.toContain("profit");
  });

  it("creates a customer from a new WhatsApp number and remembers the conversation", async () => {
    expect(await say(CUSTOMER, "hi")).toBe("store");
    expect(lastText()).toContain("Welcome to *Demo Hardware*");
    const { data: c } = await db.from("customers").select("name, source").eq("wa_id", CUSTOMER).single();
    expect(c).toEqual({ name: "Integration Test", source: "whatsapp" });
    const { data: conv } = await db.from("conversations").select("id").eq("wa_id", CUSTOMER).single();
    const history = await repo.recentMessages(conv!.id, 10);
    expect(history.map((h) => h.direction)).toEqual(["in", "out"]);
  });
});

describe("quotations on the real database", () => {
  it("creates a quotation PDF, then converts it to a sale at the quoted price", async () => {
    const make = `quote mpho 3 paint at 850 (${run})`;
    const ai = new FakeAI({
      [make]: { intent: "create_quote", items: [{ product: "Plascon Wall Paint White 20L", qty: 3, unit_price: 850 }], customer: `Mpho Test ${run}` },
    });
    await say(OWNER, make, ai);
    expect(lastText()).toContain("📝 *Quotation");
    await say(OWNER, "yes", ai);
    const quoteNo = /Quotation \*(QT-\d{5})\*/.exec(lastText())![1];
    expect(files.at(-1)!.filename).toBe(`${quoteNo}.pdf`);
    const paintBefore = await onHand("PW20");

    const accept = `${quoteNo} accepted, cash`;
    const ai2 = new FakeAI({ [accept]: { intent: "accept_quote", quote_no: quoteNo, payment_method: "cash" } });
    await say(OWNER, accept, ai2);
    expect(lastText()).toContain(`Sale from ${quoteNo}`);
    await say(OWNER, { kind: "button", id: "pa:yes", title: "✅ Confirm" }, ai2);
    expect(lastText()).toMatch(new RegExp(`✅ ${quoteNo} accepted and saved as \\*INV-\\d{5}\\*: P2,550\\.00\\.`));
    expect(await onHand("PW20")).toBe(paintBefore - 3);
    const { data: q } = await db.from("quotations").select("status").eq("quote_no", quoteNo).single();
    expect(q!.status).toBe("accepted");
  });
});
