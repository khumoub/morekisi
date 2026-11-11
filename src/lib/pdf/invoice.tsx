import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatPula } from "@/lib/money";

/** Shape returned by the `invoice_data(sale_id)` and `quote_data(quote_id)` database functions. */
export interface InvoiceData {
  /** "quote" draws a quotation (no payment, a validity date); default is an invoice. */
  kind?: "invoice" | "quote";
  valid_until?: string;
  business: {
    name: string;
    trading_name: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    vat_registered: boolean;
    vat_number: string | null;
    vat_rate_bp: number;
    invoice_footer: string | null;
  };
  sale: {
    invoice_no: string;
    created_at: string;
    payment_method: string | null;
    subtotal_excl: number;
    vat_amount: number;
    total: number;
    status: string;
  };
  customer: { name: string; phone: string | null; company: string | null } | null;
  served_by: string | null;
  items: { description: string; qty: number; unit_price: number; line_total: number }[];
  balance_after: number | null;
}

export const PAYMENT_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  orange_money: "Orange Money",
  myzaka: "MyZaka",
  smega: "Smega",
  eft: "EFT / bank transfer",
  credit: "On account (credit)",
};

const GREEN = "#047857";
const GREY = "#6b7280";

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#111827" },
  row: { flexDirection: "row" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  shop: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  muted: { color: GREY },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", color: GREEN, textAlign: "right" },
  label: { color: GREY, fontSize: 8, textTransform: "uppercase", marginBottom: 2 },
  box: { flexGrow: 1, flexBasis: 0 },
  table: { marginTop: 20, borderTopWidth: 1, borderColor: "#e5e7eb" },
  th: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#e5e7eb", paddingVertical: 6, color: GREY, fontSize: 8 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#f3f4f6", paddingVertical: 6 },
  cDesc: { flexGrow: 1, flexBasis: 0 },
  cQty: { width: 50, textAlign: "right" },
  cPrice: { width: 80, textAlign: "right" },
  cTotal: { width: 90, textAlign: "right" },
  totals: { marginTop: 12, marginLeft: "auto", width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  grand: { fontFamily: "Helvetica-Bold", fontSize: 12, borderTopWidth: 1, borderColor: "#111827", paddingTop: 6, marginTop: 3 },
  footer: { position: "absolute", left: 40, right: 40, bottom: 30, fontSize: 8, color: GREY, borderTopWidth: 1, borderColor: "#e5e7eb", paddingTop: 8 },
  void: { position: "absolute", top: 300, left: 120, fontSize: 90, color: "#fecaca", transform: "rotate(-30deg)" },
});

function qty(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

export function InvoiceDocument({ data }: { data: InvoiceData }) {
  const { business: b, sale, customer, items } = data;
  const isQuote = data.kind === "quote";
  const isTaxInvoice = b.vat_registered && !isQuote;
  const title = isQuote ? "QUOTATION" : isTaxInvoice ? "TAX INVOICE" : "INVOICE";
  const validUntil = data.valid_until
    ? new Date(`${data.valid_until}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : null;
  const date = new Date(sale.created_at).toLocaleString("en-GB", {
    timeZone: "Africa/Gaborone",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Document title={`${sale.invoice_no} ${b.name}`} author="Morekisi" subject={title}>
      <Page size="A4" style={s.page}>
        {(sale.status === "void" || sale.status === "expired") && <Text style={s.void}>{sale.status.toUpperCase()}</Text>}

        <View style={s.header}>
          <View>
            <Text style={s.shop}>{b.name}</Text>
            {b.trading_name && <Text style={s.muted}>{b.trading_name}</Text>}
            {b.address && <Text style={s.muted}>{b.address}</Text>}
            {(b.phone || b.email) && <Text style={s.muted}>{[b.phone, b.email].filter(Boolean).join(" · ")}</Text>}
            {b.vat_registered && b.vat_number && <Text style={s.muted}>VAT No: {b.vat_number}</Text>}
          </View>
          <View>
            <Text style={s.title}>{title}</Text>
            <Text style={{ textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 12 }}>{sale.invoice_no}</Text>
            <Text style={[s.muted, { textAlign: "right" }]}>{date}</Text>
          </View>
        </View>

        <View style={s.row}>
          <View style={s.box}>
            <Text style={s.label}>{isQuote ? "Prepared for" : "Bill to"}</Text>
            <Text>{customer ? customer.name : isQuote ? "—" : "Cash customer"}</Text>
            {customer?.company && <Text style={s.muted}>{customer.company}</Text>}
            {customer?.phone && <Text style={s.muted}>{customer.phone}</Text>}
          </View>
          {isQuote ? (
            <View style={s.box}>
              <Text style={s.label}>Valid until</Text>
              <Text>{validUntil ?? "—"}</Text>
            </View>
          ) : (
            <View style={s.box}>
              <Text style={s.label}>Payment</Text>
              <Text>{sale.payment_method ? (PAYMENT_LABEL[sale.payment_method] ?? sale.payment_method) : "—"}</Text>
            </View>
          )}
          <View style={s.box}>
            <Text style={s.label}>Served by</Text>
            <Text>{data.served_by ?? "—"}</Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.th}>
            <Text style={s.cDesc}>DESCRIPTION</Text>
            <Text style={s.cQty}>QTY</Text>
            <Text style={s.cPrice}>UNIT PRICE</Text>
            <Text style={s.cTotal}>AMOUNT</Text>
          </View>
          {items.map((it, i) => (
            <View key={i} style={s.tr} wrap={false}>
              <Text style={s.cDesc}>{it.description}</Text>
              <Text style={s.cQty}>{qty(Number(it.qty))}</Text>
              <Text style={s.cPrice}>{formatPula(it.unit_price)}</Text>
              <Text style={s.cTotal}>{formatPula(it.line_total)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals}>
          {b.vat_registered && (
            <>
              <View style={s.totalRow}>
                <Text style={s.muted}>Subtotal (excl. VAT)</Text>
                <Text>{formatPula(sale.subtotal_excl)}</Text>
              </View>
              <View style={s.totalRow}>
                <Text style={s.muted}>VAT {b.vat_rate_bp / 100}%</Text>
                <Text>{formatPula(sale.vat_amount)}</Text>
              </View>
            </>
          )}
          <View style={[s.totalRow, s.grand]}>
            <Text>Total</Text>
            <Text>{formatPula(sale.total)}</Text>
          </View>
          {data.balance_after !== null && (
            <View style={s.totalRow}>
              <Text style={s.muted}>Account balance now</Text>
              <Text>{formatPula(data.balance_after)}</Text>
            </View>
          )}
        </View>

        <View style={s.footer} fixed>
          {isQuote && validUntil && (
            <Text style={{ marginBottom: 4, color: "#374151" }}>
              Prices are valid until {validUntil}, subject to stock availability. Prices include VAT where applicable.
            </Text>
          )}
          {b.invoice_footer && <Text style={{ marginBottom: 4, color: "#374151" }}>{b.invoice_footer}</Text>}
          <Text>{isQuote ? "Thank you for the opportunity to quote." : "Thank you for your business."} · Generated by Morekisi</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument data={data} />);
}
