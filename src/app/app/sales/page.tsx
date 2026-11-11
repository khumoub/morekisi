import Link from "next/link";
import { getSession, hasRole } from "@/lib/auth/session";
import { userClient } from "@/lib/db/user";
import { fmtDate, METHOD_LABEL } from "@/lib/format-date";
import { formatPula } from "@/lib/money";
import { ActionForm } from "@/components/action-form";
import { Badge, buttonClass, Card, Input, PageHeader } from "@/components/ui";
import { voidSale } from "../records-actions";

export const metadata = { title: "Sales · Morekisi" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ q?: string; void?: string }> }) {
  const { current } = await getSession();
  const { q = "", void: voidId } = await searchParams;
  const canVoid = hasRole(current.role, "manager");
  const db = await userClient();

  let query = db
    .from("sales")
    .select("id, invoice_no, created_at, payment_method, total, status, channel, void_reason, customers(name), business_users(name)")
    .eq("business_id", current.businessId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (q.trim()) query = query.ilike("invoice_no", `%${q.trim()}%`);
  const { data: sales, error } = await query;
  if (error) throw new Error(error.message);

  const completed = (sales ?? []).filter((s) => s.status === "completed");
  const total = completed.reduce((t, s) => t + Number(s.total), 0);

  return (
    <>
      <PageHeader
        title="Sales"
        description={`${completed.length} invoices shown · ${formatPula(total)}`}
        actions={
          <Link href="/app/quotations" className={buttonClass("secondary")}>
            Quotations
          </Link>
        }
      />
      <form className="mb-4 flex gap-2">
        <Input name="q" defaultValue={q} placeholder="Invoice number, e.g. INV-00012" className="max-w-xs" />
        <button className={buttonClass("secondary")}>Search</button>
      </form>

      {(sales ?? []).length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-500">No sales yet. Staff record sales by sending a WhatsApp message to the shop&apos;s number.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <tr>
                <th className="px-4 py-3 font-medium">Invoice</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Payment</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">By</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {sales!.map((s) => {
                const isVoid = s.status === "void";
                return (
                  <tr key={s.id} className={isVoid ? "text-neutral-400" : ""}>
                    <td className="px-4 py-3 font-medium">
                      <a href={`/app/sales/${s.id}/pdf`} target="_blank" className="hover:underline">
                        {s.invoice_no}
                      </a>
                      {isVoid && (
                        <span className="ml-2" title={s.void_reason ?? ""}>
                          <Badge tone="red">void</Badge>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{fmtDate(s.created_at, true)}</td>
                    <td className="px-4 py-3">{(s.customers as unknown as { name: string } | null)?.name ?? "Cash customer"}</td>
                    <td className="px-4 py-3">
                      {s.payment_method === "credit" ? <Badge tone="amber">Credit</Badge> : METHOD_LABEL[s.payment_method]}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatPula(Number(s.total))}</td>
                    <td className="px-4 py-3 text-neutral-500">{(s.business_users as unknown as { name: string } | null)?.name ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <a href={`/app/sales/${s.id}/pdf`} target="_blank" className="text-emerald-700 underline">
                        PDF
                      </a>
                      {canVoid && !isVoid && (
                        <Link href={`/app/sales?void=${s.id}`} className="ml-3 text-red-700 underline">
                          Void
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canVoid && voidId && (
        <Card className="mt-6 max-w-md">
          <h2 className="mb-1 font-semibold">Void {sales?.find((s) => s.id === voidId)?.invoice_no ?? "sale"}</h2>
          <p className="mb-4 text-sm text-neutral-500">The invoice stays on record marked VOID, and its items go back into stock.</p>
          <ActionForm action={voidSale} submitLabel="Void sale" variant="danger">
            <input type="hidden" name="id" value={voidId} />
            <Input name="reason" placeholder="Reason, e.g. customer returned the goods" required />
          </ActionForm>
        </Card>
      )}
    </>
  );
}
