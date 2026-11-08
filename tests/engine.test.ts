import { beforeEach, describe, expect, it } from "vitest";
import { handleInbound } from "@/lib/engine/handle";
import type { Conversation, ProductMatch, Repo } from "@/lib/engine/types";
import type { InboundContent, InboundMessage } from "@/lib/whatsapp/inbound";
import type { OutboundMessage } from "@/lib/whatsapp/outbound";
import { parseCommand } from "@/lib/office";

/** In-memory shop: one business, one staff member, a few products. */
function fakeShop() {
  const sent: { to: string; msg: OutboundMessage }[] = [];
  const seen = new Set<string>();
  const conversations = new Map<string, Conversation>();
  const customers = new Map<string, { id: string; name: string }>();
  const products: (ProductMatch & { showInShop: boolean })[] = [
    { id: "p1", name: "Cement 42.5N 50kg", unit: "bag", price: 9500, onHand: 34, available: 34, reorderLevel: 50, trackStock: true, showInShop: true },
    { id: "p2", name: "Rebar Y12 6m", unit: "each", price: 12000, onHand: 25, available: 20, reorderLevel: 10, trackStock: true, showInShop: true },
    { id: "p3", name: "Delivery", unit: "trip", price: 0, onHand: 0, available: 0, reorderLevel: 0, trackStock: false, showInShop: false },
  ];

  const repo: Repo = {
    async findAccount(id) {
      return id === "SHOP_NUMBER"
        ? { business: { id: "b1", name: "Molefe Hardware", welcomeMessage: null }, account: { phoneNumberId: id, tokenSecretId: null } }
        : null;
    },
    async logInbound(_b, msg) {
      if (seen.has(msg.messageId)) return false;
      seen.add(msg.messageId);
      return true;
    },
    async findStaff(_b, phone) {
      return phone === "+26771000001" ? { id: "u1", name: "Neo", role: "owner" } : null;
    },
    async getOrCreateCustomer(_b, waId, name) {
      if (!customers.has(waId)) customers.set(waId, { id: `c-${waId}`, name: name ?? waId });
      return customers.get(waId)!;
    },
    async getOrCreateConversation(_b, waId) {
      if (!conversations.has(waId)) conversations.set(waId, { id: `conv-${waId}`, mode: "bot", state: {} });
      return structuredClone(conversations.get(waId)!);
    },
    async updateConversation(id, patch) {
      const conv = [...conversations.values()].find((c) => c.id === id)!;
      if (patch.mode) conv.mode = patch.mode;
      if (patch.state) conv.state = patch.state;
    },
    async logOutbound() {},
    async matchProducts(_b, q, opts) {
      const words = q.toLowerCase().split(/\s+/);
      return products.filter(
        (p) => words.some((w) => p.name.toLowerCase().includes(w)) && (!opts?.shopOnly || p.showInShop),
      );
    },
    async listCategories() {
      return [];
    },
    async shopProducts() {
      return products.filter((p) => p.showInShop && p.available > 0);
    },
  };

  let n = 0;
  const say = (from: string, content: InboundContent | string) => {
    const msg: InboundMessage = {
      phoneNumberId: "SHOP_NUMBER",
      from,
      profileName: "Tumelo",
      messageId: `m${++n}`,
      timestamp: new Date(),
      content: typeof content === "string" ? { kind: "text", text: content } : content,
      raw: {},
    };
    return handleInbound(repo, () => async (to, out) => (sent.push({ to, msg: out }), { ok: true, messageId: `o${n}` }), msg).then(
      (outcome) => ({ outcome, msg }),
    );
  };

  const lastText = () => {
    const m = sent.at(-1)!.msg;
    return m.type === "text" ? m.text : "body" in m ? m.body : "";
  };

  return { repo, sent, say, lastText, conversations, customers };
}

const STAFF = "26771000001";
const CUSTOMER = "26772000002";

describe("routing", () => {
  let shop: ReturnType<typeof fakeShop>;
  beforeEach(() => (shop = fakeShop()));

  it("ignores numbers no shop has connected", async () => {
    const msg: InboundMessage = { phoneNumberId: "OTHER", from: CUSTOMER, messageId: "x", timestamp: new Date(), content: { kind: "text", text: "hi" }, raw: {} };
    expect(await handleInbound(shop.repo, () => async () => ({ ok: true }), msg)).toBe("unknown_number");
  });

  it("sends staff to the back office and customers to the shop", async () => {
    expect((await shop.say(STAFF, "hi")).outcome).toBe("office");
    expect(shop.lastText()).toContain("back office");
    expect((await shop.say(CUSTOMER, "hi")).outcome).toBe("store");
    expect(shop.lastText()).toContain("Welcome to *Molefe Hardware*");
    expect(shop.customers.get(CUSTOMER)?.name).toBe("Tumelo");
  });

  it("processes a retried message only once", async () => {
    const { msg } = await shop.say(CUSTOMER, "hi");
    const again = await handleInbound(shop.repo, () => async () => ({ ok: true }), msg);
    expect(again).toBe("duplicate");
    expect(shop.sent).toHaveLength(1);
  });

  it("lets staff test the shop and come back", async () => {
    await shop.say(STAFF, "/shop");
    expect((await shop.say(STAFF, "hi")).outcome).toBe("store");
    await shop.say(STAFF, "/office");
    expect((await shop.say(STAFF, "hi")).outcome).toBe("office");
  });
});

describe("back office", () => {
  it("parses simple commands", () => {
    expect(parseCommand("Stock cement?")).toEqual({ kind: "stock", query: "cement" });
    expect(parseCommand("how much rebar do we have")).toEqual({ kind: "stock", query: "rebar" });
    expect(parseCommand("price of the rebar 12mm")).toEqual({ kind: "price", query: "rebar 12mm" });
    expect(parseCommand("dumela")).toEqual({ kind: "help" });
    expect(parseCommand("sold 20 cement")).toEqual({ kind: "unknown" });
  });

  it("answers stock questions with reserved stock and low-stock warnings", async () => {
    const shop = fakeShop();
    await shop.say(STAFF, "stock cement");
    expect(shop.lastText()).toBe("• *Cement 42.5N 50kg*: 34 bag ⚠️ low");
    await shop.say(STAFF, "stock rebar");
    expect(shop.lastText()).toContain("5 reserved for orders, 20 available");
  });

  it("answers price questions", async () => {
    const shop = fakeShop();
    await shop.say(STAFF, "price cement");
    expect(shop.lastText()).toBe("• *Cement 42.5N 50kg*: P95.00 / bag");
  });
});

describe("storefront", () => {
  it("answers product questions from the database, with prices and availability", async () => {
    const shop = fakeShop();
    await shop.say(CUSTOMER, "Do you have cement?");
    expect(shop.lastText()).toContain("*Cement 42.5N 50kg*: P95.00 / bag · ✅ In stock");
  });

  it("never shows hidden products such as Delivery to customers", async () => {
    const shop = fakeShop();
    await shop.say(CUSTOMER, "do you have delivery");
    expect(shop.lastText()).toContain("couldn't find");
  });

  it("browses the catalogue", async () => {
    const shop = fakeShop();
    await shop.say(CUSTOMER, { kind: "button", id: "store:browse", title: "Browse products" });
    expect(shop.lastText()).toContain("Cement 42.5N 50kg");
    expect(shop.lastText()).not.toContain("Delivery");
  });

  it("collects a quote request and hands over to a person, who then owns the chat", async () => {
    const shop = fakeShop();
    await shop.say(CUSTOMER, { kind: "button", id: "store:quote", title: "Request a quote" });
    expect(shop.lastText()).toContain("send the list of items");
    await shop.say(CUSTOMER, "50 cement, 20 rebar 12mm, delivery Tlokweng");
    expect(shop.lastText()).toContain("reply here with a quotation");
    expect(shop.conversations.get(CUSTOMER)?.mode).toBe("human");

    const before = shop.sent.length;
    expect((await shop.say(CUSTOMER, "hello?")).outcome).toBe("human_mode");
    expect(shop.sent.length).toBe(before); // bot stays quiet while a person handles it
  });

  it("falls back to the menu for anything it doesn't understand", async () => {
    const shop = fakeShop();
    await shop.say(CUSTOMER, "my cousin said you are cheap");
    const last = shop.sent.at(-1)!.msg;
    expect(last.type).toBe("buttons");
    expect(shop.lastText()).toContain("didn't quite get that");
  });
});
