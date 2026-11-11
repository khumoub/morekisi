import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { userClient } from "@/lib/db/user";
import { fmtDate } from "@/lib/format-date";
import { formatPula } from "@/lib/money";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader, Select } from "@/components/ui";
import { convertQuoteToSale } from "../records-actions";

export const metadata = { title: "Quotations · Morekisi" };

const TONE = { open: "green", accepted: "neutral", expired: "amber", cancelled: "red", rejected: "red" } as const;

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ convert?: string }> }) {
  const { current } = await getSession();
  const { convert } = await searchParams;
  const db = await userClient();
  const { data: quotes, error } = await db
    .from("quotations")
    .select("id, quote_no, created_at, valid_until, total, status, customer_name, customers(name), business_users(name)")
    .eq("business_id", current.businessId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);

  const today = new Date().toISOString().slice(0, 10);
  const rows = (quotes ?? []).map((q) => ({
    ...q,
    who: (q.customers as unknown as { name: string } | null)?.name ?? q.customer_name ?? "—",
    shown: (q.status === "open" && q.valid_until < today ? "expired" : q.status) as keyof typeof TONE,
  }));
  const toConvert = rows.find((r) => r.id === convert);

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Staff create quotations on WhatsApp, e.g. “quote Tlotlo 100 bricks and 10 cement”."
      />
      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-500">No quotations yet.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <tr>
                <th className="px-4 py-3 font-medium">Quotation</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">For</th>
                <th className="px-4 py-3 font-medium">Valid until</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rows.map((q) => (
                <tr key={q.id}>
                  <td className="px-4 py-3 font-medium">
                    <a href={`/app/quotations/${q.id}/pdf`} target="_blank" className="hover:underline">
                      {q.quote_no}
                    </a>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{fmtDate(q.created_at)}</td>
                  <td className="px-4 py-3">{q.who}</td>
                  <td className="whitespace-nowrap px-4 py-3">{fmtDate(`${q.valid_until}T12:00:00Z`)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatPula(Number(q.total))}</td>
                  <td className="px-4 py-3">
                    <Badge tone={TONE[q.shown] ?? "neutral"}>{q.shown}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <a href={`/app/quotations/${q.id}/pdf`} target="_blank" className="text-emerald-700 underline">
                      PDF
                    </a>
                    {q.status === "open" && (
                      <Link href={`/app/quotations?convert=${q.id}`} className="ml-3 text-emerald-700 underline">
                        Convert to sale
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toConvert && toConvert.status === "open" && (
        <Card className="mt-6 max-w-md">
          <h2 className="mb-1 font-semibold">
            {toConvert.quote_no} accepted: {formatPula(Number(toConvert.total))}
          </h2>
          <p className="mb-4 text-sm text-neutral-500">
            Creates an invoice at the quoted prices{toConvert.shown === "expired" ? " (this quotation has expired)" : ""} and takes the items out of stock.
          </p>
          <ActionForm action={convertQuoteToSale} submitLabel="Create invoice">
            <input type="hidden" name="id" value={toConvert.id} />
            <Select name="method" defaultValue="cash">
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="orange_money">Orange Money</option>
              <option value="myzaka">MyZaka</option>
              <option value="smega">Smega</option>
              <option value="eft">EFT / bank transfer</option>
              <option value="credit">On account (credit)</option>
            </Select>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
