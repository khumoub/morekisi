import { describe, expect, it } from "vitest";
import { renderInvoicePdf, type InvoiceData } from "@/lib/pdf/invoice";

export const SAMPLE_INVOICE: InvoiceData = {
  business: {
    name: "Molefe Hardware",
    trading_name: "Molefe Holdings (Pty) Ltd",
    address: "Plot 123, Broadhurst Industrial, Gaborone",
    phone: "+267 391 0000",
    email: "sales@molefe.co.bw",
    vat_registered: true,
    vat_number: "P01234567890",
    vat_rate_bp: 1400,
    invoice_footer: "FNB Botswana · Acc 62000000000 · Branch 280267 · Orange Money 71 234 567",
  },
  sale: {
    invoice_no: "INV-00231",
    created_at: "2026-11-11T09:42:00Z",
    payment_method: "credit",
    subtotal_excl: 219298,
    vat_amount: 30702,
    total: 250000,
    status: "completed",
  },
  customer: { name: "Kabelo Molefe", phone: "+26771234567", company: null },
  served_by: "Neo",
  items: [
    { description: "Cement 42.5N 50kg", qty: 20, unit_price: 9500, line_total: 190000 },
    { description: "Rebar Y12 6m", qty: 5, unit_price: 12000, line_total: 60000 },
  ],
  balance_after: 315000,
};

describe("invoice PDF", () => {
  it("renders a valid PDF", async () => {
    const pdf = await renderInvoicePdf(SAMPLE_INVOICE);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
    if (process.env.PDF_OUT) (await import("node:fs")).writeFileSync(process.env.PDF_OUT, pdf);
  });
});

describe("quotation PDF", () => {
  it("renders a quotation with a validity date and no payment method", async () => {
    const pdf = await renderInvoicePdf({
      ...SAMPLE_INVOICE,
      kind: "quote",
      valid_until: "2026-11-25",
      sale: { ...SAMPLE_INVOICE.sale, invoice_no: "QT-00012", payment_method: null, status: "open" },
      balance_after: null,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    if (process.env.QUOTE_OUT) (await import("node:fs")).writeFileSync(process.env.QUOTE_OUT, pdf);
  });
});
