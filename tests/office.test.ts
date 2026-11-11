import { describe, expect, it } from "vitest";
import { AiUnavailableError } from "@/lib/ai/provider";
import { FakeAI, fakeShop, OWNER, STAFF } from "./fake-shop";

const SALE = "sold 20 cement 42.5 and 5 rebar 12 to kabelo on credit";

function saleAI(extra: ConstructorParameters<typeof FakeAI>[0] = {}) {
  return new FakeAI({
    [SALE]: {
      intent: "record_sale",
      items: [
        { product: "Cement 42.5N 50kg", qty: 20, unit_price: null },
        { product: "Rebar Y12 6m", qty: 5, unit_price: null },
      ],
      customer: "kabelo",
      payment_method: "credit",
    },
    ...extra,
  });
}

describe("recording a sale on WhatsApp", () => {
  it("summarises, waits for Confirm, saves, and sends the invoice PDF", async () => {
    const shop = fakeShop({ ai: saleAI() });
    await shop.say(STAFF, SALE);

    const summary = shop.last();
    expect(summary.type).toBe("buttons");
    const text = shop.lastText();
    expect(text).toContain("🧾 *Sale — Kabelo Molefe*");
    expect(text).toContain("20 × Cement 42.5N 50kg @ P95.00 = P1,900.00");
    expect(text).toContain("5 × Rebar Y12 6m @ P120.00 = P600.00");
    expect(text).toContain("*Total P2,500.00* (incl. VAT P307.02)");
    expect(text).toContain("Payment: Credit (on account)");
    expect(text).toContain("balance will be P3,150.00 (limit P5,000.00)");
    expect(shop.sales).toHaveLength(0); // nothing saved yet

    await shop.tap(STAFF, "pa:yes", "✅ Confirm");
    expect(shop.sales).toEqual([
      {
        customerId: "c1",
        method: "credit",
        items: [
          { productId: "p1", qty: 20, unitPrice: null },
          { productId: "p3", qty: 5, unitPrice: null },
        ],
      },
    ]);
    expect(shop.files).toHaveLength(1);
    expect(shop.files[0].filename).toBe("INV-00001.pdf");
    expect(shop.files[0].data.subarray(0, 5).toString()).toBe("%PDF-");
    expect(shop.lastText()).toContain("✅ Saved as *INV-00001*: P2,500.00.");
    expect(shop.lastText()).toContain("⚠️ Cement 42.5N 50kg is down to 34 bag (reorder level 50)");
    expect(shop.pending.size).toBe(0);
  });

  it("accepts a typed yes", async () => {
    const shop = fakeShop({ ai: saleAI() });
    await shop.say(STAFF, SALE);
    await shop.say(STAFF, "ok");
    expect(shop.sales).toHaveLength(1);
  });

  it("accepts a yes in other words, understood by the AI", async () => {
    const shop = fakeShop({ ai: saleAI({ "go for it boss": { intent: "confirm" } }) });
    await shop.say(STAFF, SALE);
    await shop.say(STAFF, "go for it boss");
    expect(shop.sales).toHaveLength(1);
  });

  it("cancels without saving", async () => {
    const shop = fakeShop({ ai: saleAI() });
    await shop.say(STAFF, SALE);
    await shop.say(STAFF, "no");
    expect(shop.lastText()).toContain("Cancelled");
    expect(shop.sales).toHaveLength(0);
    await shop.tap(STAFF, "pa:yes");
    expect(shop.lastText()).toContain("isn't waiting any more");
    expect(shop.sales).toHaveLength(0);
  });

  it("refuses a confirmation after 15 minutes", async () => {
    const shop = fakeShop({ ai: saleAI() });
    await shop.say(STAFF, SALE);
    shop.advance(16);
    await shop.tap(STAFF, "pa:yes");
    expect(shop.lastText()).toContain("expired");
    expect(shop.sales).toHaveLength(0);
  });

  it("asks which product when the name is ambiguous, from a list or a typed number", async () => {
    const ai = new FakeAI({ "sold 2 cement cash": { intent: "record_sale", items: [{ product: "cement", qty: 2, unit_price: null }], payment_method: "cash" } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, "sold 2 cement cash");
    const list = shop.last();
    expect(list.type).toBe("list");
    expect(shop.lastText()).toContain("Which one do you mean by *cement*?");

    await shop.say(STAFF, "2"); // second option: Cement 32.5N
    expect(shop.lastText()).toContain("2 × Cement 32.5N 50kg @ P89.00 = P178.00");
    expect(shop.lastText()).toContain("Sale — Cash customer");
    await shop.tap(STAFF, "pa:yes");
    expect(shop.sales[0].items[0].productId).toBe("p2");
  });

  it("asks who a credit sale is for, then continues", async () => {
    const ai = new FakeAI({ "sold 1 rebar on credit": { intent: "record_sale", items: [{ product: "rebar", qty: 1, unit_price: null }], payment_method: "credit" } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, "sold 1 rebar on credit");
    expect(shop.lastText()).toContain("Who is this credit sale for?");
    await shop.say(STAFF, "Kabelo Molefe");
    expect(shop.lastText()).toContain("Sale — Kabelo Molefe");
  });

  it("adds a new customer on confirm", async () => {
    const ai = new FakeAI({ "sold 1 rebar to mpho": { intent: "record_sale", items: [{ product: "rebar", qty: 1, unit_price: null }], customer: "mpho" } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, "sold 1 rebar to mpho");
    expect(shop.lastText()).toContain("👤 New customer *Mpho* will be added");
    expect(shop.lastText()).toContain('Payment: Cash _(say "credit"');
    await shop.tap(STAFF, "pa:yes");
    expect(shop.createdCustomers).toEqual(["Mpho"]);
    expect(shop.sales[0].customerId).toBe("c3");
  });

  it("tells the person when a product doesn't exist", async () => {
    const ai = new FakeAI({ "sold 3 paint": { intent: "record_sale", items: [{ product: "paint", qty: 3, unit_price: null }] } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, "sold 3 paint");
    expect(shop.lastText()).toContain("I couldn't find *paint*");
    expect(shop.pending.size).toBe(0);
  });

  it("asks for quantities instead of guessing", async () => {
    const ai = new FakeAI({ "sold cement to kabelo": { intent: "record_sale", items: [{ product: "cement", qty: null, unit_price: null }] } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, "sold cement to kabelo");
    expect(shop.lastText()).toContain("How many *cement*?");
  });

  it("blocks big discounts for staff but allows the owner", async () => {
    const msg = "sold 1 cement 42.5 at P50";
    const ai = new FakeAI({ [msg]: { intent: "record_sale", items: [{ product: "Cement 42.5N 50kg", qty: 1, unit_price: 50 }] } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, msg);
    expect(shop.lastText()).toContain("Only the owner or a manager can give that discount");
    await shop.say(OWNER, msg);
    expect(shop.lastText()).toContain("1 × Cement 42.5N 50kg @ P50.00 = P50.00");
  });

  it("warns when selling more than is in stock", async () => {
    const msg = "sold 30 rebar";
    const ai = new FakeAI({ [msg]: { intent: "record_sale", items: [{ product: "Rebar Y12 6m", qty: 30, unit_price: null }] } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, msg);
    expect(shop.lastText()).toContain("⚠️ Only 20 each of Rebar Y12 6m available");
  });

  it("a new action replaces one waiting for confirmation", async () => {
    const shop = fakeShop({ ai: saleAI({ "sold 1 rebar cash": { intent: "record_sale", items: [{ product: "Rebar Y12 6m", qty: 1, unit_price: null }], payment_method: "cash" } }) });
    await shop.say(STAFF, SALE);
    await shop.say(STAFF, "sold 1 rebar cash");
    await shop.tap(STAFF, "pa:yes");
    expect(shop.sales).toHaveLength(1);
    expect(shop.sales[0].items).toEqual([{ productId: "p3", qty: 1, unitPrice: null }]);
  });
});

describe("payments and stock in", () => {
  it("records a customer payment and shows the new balance", async () => {
    const ai = new FakeAI({ "kabelo paid 500 OM": { intent: "record_payment", customer: "kabelo", amount: 500, payment_method: "orange_money" } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, "kabelo paid 500 OM");
    expect(shop.lastText()).toContain("Balance: P650.00 → *P150.00*");
    expect(shop.lastText()).toContain("Method: Orange Money");
    await shop.tap(STAFF, "pa:yes");
    expect(shop.payments).toEqual([{ businessId: "b1", userId: "u1", customerId: "c1", amount: 50000, method: "orange_money" }]);
    expect(shop.lastText()).toContain("✅ Payment saved (*RCPT-00001*): P500.00 from Kabelo Molefe. Balance now *P150.00*.");
  });

  it("refuses a payment for an unknown customer", async () => {
    const ai = new FakeAI({ "mpho paid 100": { intent: "record_payment", customer: "mpho", amount: 100 } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, "mpho paid 100");
    expect(shop.lastText()).toContain("couldn't find a customer called *mpho*");
  });

  it("receives stock from a supplier with a cost price", async () => {
    const msg = "received 200 cement 42.5 from builders depot at 78";
    const ai = new FakeAI({ [msg]: { intent: "stock_in", items: [{ product: "Cement 42.5N 50kg", qty: 200, unit_price: 78 }], supplier: "Builders Depot" } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, msg);
    expect(shop.lastText()).toContain("📦 *Stock received from Builders Depot*");
    expect(shop.lastText()).toContain("+200 bag Cement 42.5N 50kg @ P78.00 cost");
    await shop.tap(STAFF, "pa:yes");
    expect(shop.stockIns).toEqual([{ businessId: "b1", userId: "u1", productId: "p1", qty: 200, unitCost: 7800, supplier: "Builders Depot" }]);
    expect(shop.lastText()).toContain("Cement 42.5N 50kg: 254 bag available");
  });
});

describe("questions", () => {
  it("hides profit from staff and shows it to the owner", async () => {
    const ai = new FakeAI({ "sales today": { intent: "report", period: "today" } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, "sales today");
    expect(shop.lastText()).toContain("Sales: *P18,400.00* from 12 invoices");
    expect(shop.lastText()).not.toContain("profit");
    await shop.say(OWNER, "sales today");
    expect(shop.lastText()).toContain("Gross profit: *P3,120.00*");
  });

  it("answers open questions from real data only", async () => {
    const ai = new FakeAI({ "what sells best?": { intent: "ask", question: "What is the best-selling product?" } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, "what sells best?");
    expect(shop.lastText()).toBe("Cement was your best seller this month.");
    const input = ai.textCalls[0].input;
    expect(input).toContain("Cement 42.5N 50kg: 120");
    expect(input).toContain("may not see profit"); // staff
    expect(input).not.toContain("gross profit");
  });

  it("lists who owes money", async () => {
    const ai = new FakeAI({ "who owes us": { intent: "customer_balance" } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, "who owes us");
    expect(shop.lastText()).toContain("• Kabelo Molefe: P650.00");
  });

  it("gives the AI the catalogue and says what is waiting", async () => {
    const ai = saleAI({ "change it to 25": { intent: "unclear", reply: "x" } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, SALE);
    await shop.say(STAFF, "change it to 25");
    const req = ai.jsonCalls[1];
    expect(req.shopContext).toContain("- Cement 42.5N 50kg (bag)");
    expect(req.shopContext).not.toContain("Delivery");
    expect(req.input).toContain("Waiting for confirmation: 🧾 *Sale — Kabelo Molefe*");
  });
});

describe("when the AI is unavailable", () => {
  it("falls back to keyword commands", async () => {
    const ai = new FakeAI({ "stock rebar": new AiUnavailableError("down", "error") });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, "stock rebar");
    expect(shop.lastText()).toContain("Rebar Y12 6m");
  });

  it("apologises when there's no fallback", async () => {
    const ai = new FakeAI({ "sold 2 cement": new Error("timeout") });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, "sold 2 cement");
    expect(shop.lastText()).toContain("couldn't process that just now");
  });

  it("uses the AI's clarifying question when it's unsure", async () => {
    const ai = new FakeAI({ "kabelo 20": { intent: "unclear", reply: "Did Kabelo buy 20 of something, or pay P20?" } });
    const shop = fakeShop({ ai });
    await shop.say(STAFF, "kabelo 20");
    expect(shop.lastText()).toBe("Did Kabelo buy 20 of something, or pay P20?");
  });
});

describe("quotations", () => {
  const QUOTE = "quote tlotlo 10 cement 42.5 and 2 rebar 12mm at 110";
  const quoteAI = (extra: ConstructorParameters<typeof FakeAI>[0] = {}) =>
    new FakeAI({
      [QUOTE]: {
        intent: "create_quote",
        items: [
          { product: "Cement 42.5N 50kg", qty: 10, unit_price: null },
          { product: "Rebar Y12 6m", qty: 2, unit_price: 110 },
        ],
        customer: "tlotlo",
      },
      "QT-00001 accepted, cash": { intent: "accept_quote", quote_no: "QT-00001", payment_method: "cash" },
      "quote 1 accepted on credit": { intent: "accept_quote", quote_no: "1", payment_method: "credit" },
      ...extra,
    });

  it("prepares a quotation PDF after confirmation, without touching stock", async () => {
    const shop = fakeShop({ ai: quoteAI() });
    await shop.say(STAFF, QUOTE);
    expect(shop.lastText()).toContain("📝 *Quotation — Tlotlo Ntsima*");
    expect(shop.lastText()).toContain("10 × Cement 42.5N 50kg @ P95.00 = P950.00");
    expect(shop.lastText()).toContain("2 × Rebar Y12 6m @ P110.00 = P220.00");
    expect(shop.lastText()).toContain("*Total P1,170.00*");
    await shop.tap(STAFF, "pa:yes");
    expect(shop.quotes).toHaveLength(1);
    expect(shop.files.at(-1)!.filename).toBe("QT-00001.pdf");
    expect(shop.files.at(-1)!.data.subarray(0, 5).toString()).toBe("%PDF-");
    expect(shop.lastText()).toContain("When they accept, send *QT-00001 accepted, cash*");
    expect(shop.sales).toHaveLength(0);
    expect(shop.products.find((p) => p.id === "p1")!.onHand).toBe(54);
  });

  it("quotes someone who isn't a customer yet", async () => {
    const msg = "quote mpho 5 rebar";
    const shop = fakeShop({ ai: new FakeAI({ [msg]: { intent: "create_quote", items: [{ product: "Rebar Y12 6m", qty: 5, unit_price: null }], customer: "mpho" } }) });
    await shop.say(STAFF, msg);
    expect(shop.lastText()).toContain("*Mpho* isn't a customer yet");
    await shop.tap(STAFF, "pa:yes");
    expect(shop.quotes[0]).toMatchObject({ customerId: null, customerName: "Mpho" });
    expect(shop.createdCustomers).toEqual([]);
  });

  it("turns an accepted quotation into a sale at the quoted prices", async () => {
    const shop = fakeShop({ ai: quoteAI() });
    await shop.say(STAFF, QUOTE);
    await shop.tap(STAFF, "pa:yes");
    shop.products.find((p) => p.id === "p3")!.price = 15000; // price went up since the quote

    await shop.say(STAFF, "QT-00001 accepted, cash");
    expect(shop.lastText()).toContain("🧾 *Sale from QT-00001 — Tlotlo Ntsima*");
    expect(shop.lastText()).toContain("*Total P1,170.00* (quoted prices)");
    await shop.tap(STAFF, "pa:yes");
    expect(shop.sales[0]).toMatchObject({ customerId: "c2", method: "cash" });
    expect(shop.sales[0].items).toContainEqual({ productId: "p3", qty: 2, unitPrice: 11000 });
    expect(shop.lastText()).toContain("✅ QT-00001 accepted and saved as *INV-00001*: P1,170.00.");
    expect(shop.files.at(-1)!.filename).toBe("INV-00001.pdf");

    await shop.say(STAFF, "quote 1 accepted on credit");
    expect(shop.lastText()).toContain("Quotation *QT-00001* is already accepted.");
  });

  it("says when a quotation number doesn't exist", async () => {
    const shop = fakeShop({ ai: quoteAI({ "QT-99 accepted": { intent: "accept_quote", quote_no: "QT-99" } }) });
    await shop.say(STAFF, "QT-99 accepted");
    expect(shop.lastText()).toContain("couldn't find quotation *QT-00099*");
  });

  it("understands the accepted-quotation form without AI", async () => {
    const { parseCommand } = await import("@/lib/office");
    const { normaliseQuoteNo } = await import("@/lib/office/flows");
    expect(parseCommand("QT-00012 accepted, cash")).toMatchObject({ intent: "accept_quote", payment_method: "cash" });
    expect(normaliseQuoteNo(parseCommand("quote qt 7 accepted").quote_no)).toBe("QT-00007");
    expect(normaliseQuoteNo("QT-00012")).toBe("QT-00012");
    expect(normaliseQuoteNo(null)).toBeNull();
  });
});
