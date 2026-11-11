import { handleInbound } from "@/lib/engine/handle";
import type { Interpretation } from "@/lib/ai/intent";
import type { JsonRequest, LlmProvider, TextRequest } from "@/lib/ai/provider";
import type { Conversation, CustomerMatch, PendingAction, ProductMatch, Repo, Role } from "@/lib/engine/types";
import type { InboundContent, InboundMessage } from "@/lib/whatsapp/inbound";
import type { OutboundMessage } from "@/lib/whatsapp/outbound";

/**
 * An in-memory shop for engine tests: products with stock, customers with balances,
 * staff, conversations, pending actions, and a record of every sale/payment/stock-in.
 */

export const STAFF = "26771000001"; // role staff
export const OWNER = "26771000002"; // role owner
export const CUSTOMER = "26772000002";

type Product = ProductMatch & { showInShop: boolean };

/** Scripted AI: maps the exact message text to an interpretation. */
export class FakeAI implements LlmProvider {
  readonly name = "fake";
  jsonCalls: JsonRequest[] = [];
  textCalls: TextRequest[] = [];
  constructor(
    public script: Record<string, Partial<Interpretation> | Error> = {},
    public answer = "Cement was your best seller this month.",
  ) {}
  async json(req: JsonRequest) {
    this.jsonCalls.push(req);
    const message = req.input.split("New message from staff:\n")[1] ?? "";
    const entry = this.script[message];
    if (entry instanceof Error) throw entry;
    return { ...NULLS, intent: "unclear", reply: null, ...(entry ?? {}) };
  }
  async text(req: TextRequest) {
    this.textCalls.push(req);
    return this.answer;
  }
}

const NULLS = {
  items: [],
  customer: null,
  payment_method: null,
  amount: null,
  supplier: null,
  period: null,
  quote_no: null,
  question: null,
  reply: null,
  language: "en",
};

export function fakeShop(opts: { ai?: LlmProvider | null; now?: Date } = {}) {
  const sent: { to: string; msg: OutboundMessage }[] = [];
  const files: { to: string; filename: string; data: Buffer; caption?: string }[] = [];
  const seen = new Set<string>();
  const conversations = new Map<string, Conversation>();
  const waCustomers = new Map<string, { id: string; name: string }>();
  const pending = new Map<string, PendingAction>();
  const sales: { customerId: string | null; method: string; items: { productId: string; qty: number; unitPrice: number | null }[] }[] = [];
  const payments: { customerId: string; amount: number; method: string }[] = [];
  const stockIns: { productId: string; qty: number; unitCost: number | null; supplier: string | null }[] = [];
  const createdCustomers: string[] = [];
  const quotes: { id: string; quoteNo: string; status: string; customerId: string | null; customerName: string | null; validUntil: string; items: { productId: string; qty: number; unitPrice: number }[] }[] = [];
  let clock = opts.now ?? new Date("2026-11-11T10:00:00Z");

  const products: Product[] = [
    { id: "p1", name: "Cement 42.5N 50kg", unit: "bag", price: 9500, onHand: 54, available: 54, reorderLevel: 50, trackStock: true, showInShop: true },
    { id: "p2", name: "Cement 32.5N 50kg", unit: "bag", price: 8900, onHand: 100, available: 100, reorderLevel: 20, trackStock: true, showInShop: true },
    { id: "p3", name: "Rebar Y12 6m", unit: "each", price: 12000, onHand: 25, available: 20, reorderLevel: 10, trackStock: true, showInShop: true },
    { id: "p4", name: "Delivery", unit: "trip", price: 0, onHand: 0, available: 0, reorderLevel: 0, trackStock: false, showInShop: false },
  ];
  const customers = [
    { id: "c1", name: "Kabelo Molefe", balance: 65000, creditLimit: 500000 },
    { id: "c2", name: "Tlotlo Ntsima", balance: 0, creditLimit: 0 },
  ];
  const staff: Record<string, { id: string; name: string; role: Role }> = {
    ["+" + STAFF]: { id: "u1", name: "Kago Sello", role: "staff" },
    ["+" + OWNER]: { id: "u2", name: "Neo Molefe", role: "owner" },
  };

  const words = (q: string) => q.toLowerCase().split(/[^a-z0-9.]+/).filter((w) => w.length > 1);
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
      return staff[phone] ?? null;
    },
    async getOrCreateCustomer(_b, waId, name) {
      if (!waCustomers.has(waId)) waCustomers.set(waId, { id: `wc-${waId}`, name: name ?? waId });
      return waCustomers.get(waId)!;
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
    async recentMessages() {
      return [];
    },
    async matchProducts(_b, q, o) {
      const ws = words(q);
      return products
        .filter((p) => (!o?.shopOnly || p.showInShop) && (p.name.toLowerCase() === q.toLowerCase() || ws.every((w) => p.name.toLowerCase().includes(w))))
        .map((p) => ({ id: p.id, name: p.name, unit: p.unit, price: p.price, onHand: p.onHand, available: p.available, reorderLevel: p.reorderLevel, trackStock: p.trackStock }));
    },
    async listCategories() {
      return [];
    },
    async shopProducts() {
      return products.filter((p) => p.showInShop && p.available > 0);
    },
    async catalogue() {
      return products.filter((p) => p.trackStock).map((p) => ({ name: p.name, unit: p.unit }));
    },
    async stockLevels(ids) {
      return products
        .filter((p) => ids.includes(p.id) && p.trackStock)
        .map((p) => ({ productId: p.id, name: p.name, unit: p.unit, available: p.available, reorderLevel: p.reorderLevel, lowStock: p.available <= p.reorderLevel }));
    },
    async lowStock() {
      return [];
    },
    async shopSettings() {
      return { vatRegistered: true, vatRateBp: 1400, pricesIncludeVat: true, maxDiscountBp: 1000, timezone: "Africa/Gaborone" };
    },
    async matchCustomers(_b, q): Promise<CustomerMatch[]> {
      const ws = words(q);
      return customers
        .filter((c) => ws.every((w) => c.name.toLowerCase().includes(w)))
        .map((c) => ({ id: c.id, name: c.name, phone: null, score: c.name.toLowerCase() === q.toLowerCase() ? 1 : 0.7 }));
    },
    async createCustomer(_b, name) {
      createdCustomers.push(name);
      const c = { id: `c${customers.length + 1}`, name, balance: 0, creditLimit: 0 };
      customers.push(c);
      return { id: c.id, name };
    },
    async customerBalance(id) {
      const c = customers.find((x) => x.id === id)!;
      return { balance: c.balance, creditLimit: c.creditLimit };
    },
    async topDebtors() {
      return customers.filter((c) => c.balance > 0).map((c) => ({ name: c.name, balance: c.balance, oldestUnpaid: null }));
    },
    async getPending(userId) {
      return pending.get(userId) ?? null;
    },
    async savePending(_b, userId, kind, payload) {
      pending.set(userId, { kind, payload: structuredClone(payload), expiresAt: new Date(clock.getTime() + 15 * 60_000) });
    },
    async clearPending(userId) {
      pending.delete(userId);
    },
    async createSale(input) {
      sales.push({ customerId: input.customerId, method: input.method, items: input.items });
      let total = 0;
      for (const it of input.items) {
        const p = products.find((x) => x.id === it.productId)!;
        p.onHand -= it.qty;
        p.available -= it.qty;
        total += Math.round(it.qty * (it.unitPrice ?? p.price));
      }
      if (input.method === "credit") customers.find((c) => c.id === input.customerId)!.balance += total;
      return { id: `s${sales.length}`, invoiceNo: `INV-${String(sales.length).padStart(5, "0")}`, total };
    },
    async recordPayment(input) {
      payments.push(input);
      customers.find((c) => c.id === input.customerId)!.balance -= input.amount;
      return { receiptNo: `RCPT-${String(payments.length).padStart(5, "0")}` };
    },
    async stockIn(input) {
      stockIns.push(input);
      const p = products.find((x) => x.id === input.productId)!;
      p.onHand += input.qty;
      p.available += input.qty;
    },
    async invoiceData(saleId) {
      const n = Number(saleId.slice(1));
      const sale = sales[n - 1];
      const items = sale.items.map((it) => {
        const p = products.find((x) => x.id === it.productId)!;
        const price = it.unitPrice ?? p.price;
        return { description: p.name, qty: it.qty, unit_price: price, line_total: Math.round(it.qty * price) };
      });
      const total = items.reduce((t, i) => t + i.line_total, 0);
      return {
        business: { name: "Molefe Hardware", trading_name: null, address: null, phone: null, email: null, vat_registered: true, vat_number: "P0123", vat_rate_bp: 1400, invoice_footer: null },
        sale: { invoice_no: `INV-${String(n).padStart(5, "0")}`, created_at: clock.toISOString(), payment_method: sale.method, subtotal_excl: total - Math.round((total * 1400) / 11400), vat_amount: Math.round((total * 1400) / 11400), total, status: "completed" },
        customer: null,
        served_by: "Kago",
        items,
        balance_after: null,
      };
    },
    async createQuote(input) {
      const items = input.items.map((i) => ({ productId: i.productId, qty: i.qty, unitPrice: i.unitPrice ?? products.find((p) => p.id === i.productId)!.price }));
      const q = {
        id: `q${quotes.length + 1}`,
        quoteNo: `QT-${String(quotes.length + 1).padStart(5, "0")}`,
        status: "open",
        customerId: input.customerId,
        customerName: input.customerName,
        validUntil: "2026-11-25",
        items,
      };
      quotes.push(q);
      return { id: q.id, quoteNo: q.quoteNo, total: items.reduce((t, i) => t + Math.round(i.qty * i.unitPrice), 0), validUntil: q.validUntil };
    },
    async quoteData(quoteId) {
      const q = quotes.find((x) => x.id === quoteId)!;
      const items = q.items.map((i) => ({ description: products.find((p) => p.id === i.productId)!.name, qty: i.qty, unit_price: i.unitPrice, line_total: Math.round(i.qty * i.unitPrice) }));
      const total = items.reduce((t, i) => t + i.line_total, 0);
      return {
        kind: "quote" as const,
        valid_until: q.validUntil,
        business: { name: "Molefe Hardware", trading_name: null, address: null, phone: null, email: null, vat_registered: true, vat_number: "P0123", vat_rate_bp: 1400, invoice_footer: null },
        sale: { invoice_no: q.quoteNo, created_at: clock.toISOString(), payment_method: null, subtotal_excl: total, vat_amount: 0, total, status: q.status },
        customer: q.customerName ? { name: q.customerName, phone: null, company: null } : null,
        served_by: "Kago",
        items,
        balance_after: null,
      };
    },
    async findQuote(_b, quoteNo) {
      const q = quotes.find((x) => x.quoteNo === quoteNo);
      if (!q) return null;
      const items = q.items.map((i) => ({ description: products.find((p) => p.id === i.productId)!.name, qty: i.qty, unitPrice: i.unitPrice, lineTotal: Math.round(i.qty * i.unitPrice) }));
      const name = q.customerId ? customers.find((c) => c.id === q.customerId)!.name : q.customerName;
      return { id: q.id, quoteNo: q.quoteNo, status: q.status, total: items.reduce((t, i) => t + i.lineTotal, 0), validUntil: q.validUntil, customerId: q.customerId, customerName: name, items };
    },
    async convertQuote({ quoteId, userId, method }) {
      const q = quotes.find((x) => x.id === quoteId)!;
      if (q.status !== "open") throw new Error(`quotation ${q.quoteNo} is ${q.status}`);
      q.status = "accepted";
      return repo.createSale({ businessId: "b1", userId, customerId: q.customerId, method, items: q.items });
    },
    async salesSummary() {
      return { count: 12, revenue: 1840000, vat: 225965, grossProfit: 312000, creditSales: 250000 };
    },
    async topProducts() {
      return [{ name: "Cement 42.5N 50kg", qty: 120, revenue: 1140000 }];
    },
  };

  let n = 0;
  const say = async (from: string, content: InboundContent | string) => {
    const msg: InboundMessage = {
      phoneNumberId: "SHOP_NUMBER",
      from,
      profileName: "Tumelo",
      messageId: `m${++n}`,
      timestamp: clock,
      content: typeof content === "string" ? { kind: "text", text: content } : content,
      raw: {},
    };
    const outcome = await handleInbound(
      {
        repo,
        ai: opts.ai ?? null,
        now: () => clock,
        messengerFor: () => ({
          send: async (to, out) => (sent.push({ to, msg: out }), { ok: true, messageId: `o${n}` }),
          sendFile: async (to, file, caption) => (files.push({ to, filename: file.filename, data: file.data, caption }), { ok: true, messageId: `f${n}` }),
        }),
      },
      msg,
    );
    return { outcome, msg };
  };
  const tap = (from: string, id: string, title = id) => say(from, { kind: "button", id, title });
  const pick = (from: string, id: string, title = id) => say(from, { kind: "list", id, title });

  const textOf = (m: OutboundMessage) => (m.type === "text" ? m.text : "body" in m ? m.body : "");
  const lastText = () => textOf(sent.at(-1)!.msg);
  const last = () => sent.at(-1)!.msg;
  const advance = (minutes: number) => (clock = new Date(clock.getTime() + minutes * 60_000));

  return { repo, sent, files, say, tap, pick, last, lastText, textOf, conversations, customers, products, pending, sales, payments, stockIns, createdCustomers, quotes, advance };
}
