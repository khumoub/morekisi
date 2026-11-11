import { describe, expect, it } from "vitest";
import { handleInbound } from "@/lib/engine/handle";
import type { InboundMessage } from "@/lib/whatsapp/inbound";
import { parseCommand } from "@/lib/office";
import { CUSTOMER, fakeShop, STAFF } from "./fake-shop";

describe("routing", () => {
  it("ignores numbers no shop has connected", async () => {
    const shop = fakeShop();
    const msg: InboundMessage = { phoneNumberId: "OTHER", from: CUSTOMER, messageId: "x", timestamp: new Date(), content: { kind: "text", text: "hi" }, raw: {} };
    const out = await handleInbound({ repo: shop.repo, ai: null, messengerFor: () => ({ send: async () => ({ ok: true }), sendFile: async () => ({ ok: true }) }) }, msg);
    expect(out).toBe("unknown_number");
  });

  it("sends staff to the back office and customers to the shop", async () => {
    const shop = fakeShop();
    expect((await shop.say(STAFF, "hi")).outcome).toBe("office");
    expect(shop.lastText()).toContain("back office");
    expect((await shop.say(CUSTOMER, "hi")).outcome).toBe("store");
    expect(shop.lastText()).toContain("Welcome to *Molefe Hardware*");
  });

  it("processes a retried message only once", async () => {
    const shop = fakeShop();
    const { msg } = await shop.say(CUSTOMER, "hi");
    const again = await handleInbound({ repo: shop.repo, ai: null, messengerFor: () => ({ send: async () => ({ ok: true }), sendFile: async () => ({ ok: true }) }) }, msg);
    expect(again).toBe("duplicate");
    expect(shop.sent).toHaveLength(1);
  });

  it("lets staff test the shop and come back", async () => {
    const shop = fakeShop();
    await shop.say(STAFF, "/shop");
    expect((await shop.say(STAFF, "hi")).outcome).toBe("store");
    await shop.say(STAFF, "/office");
    expect((await shop.say(STAFF, "hi")).outcome).toBe("office");
  });
});

describe("keyword fallback (no AI configured)", () => {
  it("parses simple commands", () => {
    expect(parseCommand("Stock cement?")).toMatchObject({ intent: "check_stock", items: [{ product: "cement" }] });
    expect(parseCommand("how much rebar do we have")).toMatchObject({ intent: "check_stock", items: [{ product: "rebar" }] });
    expect(parseCommand("price of the rebar 12mm")).toMatchObject({ intent: "check_price", items: [{ product: "rebar 12mm" }] });
    expect(parseCommand("sales this week")).toMatchObject({ intent: "report", period: "this_week" });
    expect(parseCommand("who owes us")).toMatchObject({ intent: "customer_balance" });
    expect(parseCommand("dumela")).toMatchObject({ intent: "help" });
    expect(parseCommand("sold 20 cement")).toMatchObject({ intent: "unclear" });
  });

  it("answers stock questions with reserved stock and low-stock warnings", async () => {
    const shop = fakeShop();
    await shop.say(STAFF, "stock rebar");
    expect(shop.lastText()).toContain("5 reserved for orders, 20 available");
    await shop.say(STAFF, "stock cement");
    expect(shop.lastText()).toContain("*Cement 42.5N 50kg*: 54 bag");
  });

  it("explains it can't do sales without AI", async () => {
    const shop = fakeShop();
    await shop.say(STAFF, "sold 20 cement to kabelo");
    expect(shop.lastText()).toContain("didn't understand");
  });
});

describe("storefront", () => {
  it("answers product questions from the database, with prices and availability", async () => {
    const shop = fakeShop();
    await shop.say(CUSTOMER, "Do you have rebar?");
    expect(shop.lastText()).toContain("*Rebar Y12 6m*: P120.00 / each · ✅ In stock");
  });

  it("never shows hidden products such as Delivery to customers", async () => {
    const shop = fakeShop();
    await shop.say(CUSTOMER, "do you have delivery");
    expect(shop.lastText()).toContain("couldn't find");
  });

  it("browses the catalogue", async () => {
    const shop = fakeShop();
    await shop.tap(CUSTOMER, "store:browse", "Browse products");
    expect(shop.lastText()).toContain("Cement 42.5N 50kg");
    expect(shop.lastText()).not.toContain("Delivery");
  });

  it("collects a quote request and hands over to a person, who then owns the chat", async () => {
    const shop = fakeShop();
    await shop.tap(CUSTOMER, "store:quote", "Request a quote");
    await shop.say(CUSTOMER, "50 cement, 20 rebar 12mm, delivery Tlokweng");
    expect(shop.lastText()).toContain("reply here with a quotation");
    expect(shop.conversations.get(CUSTOMER)?.mode).toBe("human");
    const before = shop.sent.length;
    expect((await shop.say(CUSTOMER, "hello?")).outcome).toBe("human_mode");
    expect(shop.sent.length).toBe(before);
  });
});
