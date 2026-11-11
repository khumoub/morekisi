import "server-only";
import { adminClient } from "@/lib/db/server";
import { userClient } from "@/lib/db/user";
import { renderInvoicePdf, type InvoiceData } from "@/lib/pdf/invoice";
import { renderStatementPdf, type StatementData } from "@/lib/pdf/statement";

/**
 * PDFs for the dashboard. Each first checks, as the signed-in user (RLS), that the record belongs
 * to one of their shops; only then is the full document data read server-side.
 */

function pdfResponse(pdf: Buffer, filename: string) {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function invoicePdf(saleId: string): Promise<Response> {
  const db = await userClient();
  const { data: sale } = await db.from("sales").select("id, invoice_no").eq("id", saleId).maybeSingle();
  if (!sale) return new Response("Not found", { status: 404 });
  const { data, error } = await adminClient().rpc("invoice_data", { p_sale: sale.id });
  if (error) return new Response(error.message, { status: 500 });
  return pdfResponse(await renderInvoicePdf(data as InvoiceData), `${sale.invoice_no}.pdf`);
}

export async function quotePdf(quoteId: string): Promise<Response> {
  const db = await userClient();
  const { data: quote } = await db.from("quotations").select("id, quote_no").eq("id", quoteId).maybeSingle();
  if (!quote) return new Response("Not found", { status: 404 });
  const { data, error } = await adminClient().rpc("quote_data", { p_quote: quote.id });
  if (error) return new Response(error.message, { status: 500 });
  return pdfResponse(await renderInvoicePdf(data as InvoiceData), `${quote.quote_no}.pdf`);
}

export async function statementPdf(customerId: string): Promise<Response> {
  const db = await userClient();
  const { data: customer } = await db
    .from("customers")
    .select("id, name, phone, company, businesses(name, address, phone, vat_number, invoice_footer)")
    .eq("id", customerId)
    .maybeSingle();
  if (!customer) return new Response("Not found", { status: 404 });
  const { data: rows, error } = await db.rpc("customer_statement", { p_customer: customer.id });
  if (error) return new Response(error.message, { status: 500 });

  const data: StatementData = {
    business: customer.businesses as unknown as StatementData["business"],
    customer: { name: customer.name, phone: customer.phone, company: customer.company },
    generatedAt: new Date().toISOString(),
    rows: (rows as { at: string; kind: "invoice" | "payment"; ref: string; detail: string; debit: number; credit: number }[]).map((r) => ({
      ...r,
      debit: Number(r.debit),
      credit: Number(r.credit),
    })),
  };
  const safeName = customer.name.replace(/[^\w-]+/g, "-");
  return pdfResponse(await renderStatementPdf(data), `Statement-${safeName}.pdf`);
}
