import { notFound } from "next/navigation";
import { getSession, hasRole } from "@/lib/auth/session";
import { userClient } from "@/lib/db/user";
import { fmtDate, METHOD_LABEL } from "@/lib/format-date";
import { formatPula } from "@/lib/money";
import { Badge, buttonClass, Card, PageHeader } from "@/components/ui";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "Customer · Morekisi" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { current } = await getSession();
  const db = await userClient();

  const { data: c } = await db
    .from("customers")
    .select("id, name, phone, company, credit_limit, tags, notes, source, created_at, last_seen_at")
    .eq("id", id)
    .eq("business_id", current.businessId)
    .maybeSingle();
  if (!c) notFound();

  const [{ data: statement }, { data: sales }, { data: quotes }] = await Promise.all([
    db.rpc("customer_statement", { p_customer: id }),
    db.from("sales").select("id, invoice_no, created_at, payment_method, total, status").eq("customer_id", id).order("created_at", { ascending: false }).limit(50),
    db.from("quotations").select("id, quote_no, created_at, total, status").eq("customer_id", id).order("created_at", { ascending: false }).limit(20),
  ]);

  let running = 0;
  const rows = ((statement ?? []) as { at: string; kind: string; ref: string; detail: string; debit: number; credit: number }[]).map((r) => {
    running += Number(r.debit) - Number(r.credit);
    return { ...r, balance: running };
  });
  const balance = running;
  const limit = Number(c.credit_limit);
  const allSales = sales ?? [];
  const lifetime = allSales.filter((s) => s.status === "completed").reduce((t, s) => t + Number(s.total), 0);

  return (
    <>
      <PageHeader
        title={c.name}
        description={[c.company, c.phone].filter(Boolean).join(" · ") || undefined}
        actions={
          <a href={`/app/customers/${c.id}/statement`} target="_blank" className={buttonClass("secondary")}>
            Statement PDF
          </a>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-neutral-500">Owes the shop</p>
          <p className={`mt-1 text-3xl font-semibold tabular-nums ${limit > 0 && balance > limit ? "text-red-700" : ""}`}>{formatPula(Math.max(balance, 0))}</p>
          {limit > 0 && <p className="text-xs text-neutral-500">Limit {formatPula(limit)}</p>}
          {balance < 0 && <p className="text-xs text-emerald-700">In credit: {formatPula(-balance)}</p>}
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Bought (last 50 invoices)</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{formatPula(lifetime)}</p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Customer since</p>
          <p className="mt-1 text-xl font-semibold">{fmtDate(c.created_at)}</p>
          <p className="text-xs text-neutral-500">{c.source === "whatsapp" ? "Joined by WhatsApp" : "Added by staff"}</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-3 font-semibold">Account (credit sales and payments)</h2>
            {rows.length === 0 ? (
              <p className="text-sm text-neutral-500">No credit sales or payments.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Reference</th>
                    <th className="py-2 text-right font-medium">Charged</th>
                    <th className="py-2 text-right font-medium">Paid</th>
                    <th className="py-2 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="py-2">{fmtDate(r.at)}</td>
                      <td className="py-2">
                        {r.ref}
                        {r.kind === "payment" && <span className="text-neutral-400"> · {r.detail}</span>}
                      </td>
                      <td className="py-2 text-right tabular-nums">{Number(r.debit) ? formatPula(Number(r.debit)) : ""}</td>
                      <td className="py-2 text-right tabular-nums text-emerald-700">{Number(r.credit) ? formatPula(Number(r.credit)) : ""}</td>
                      <td className="py-2 text-right tabular-nums font-medium">{formatPula(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Invoices</h2>
            {allSales.length === 0 ? (
              <p className="text-sm text-neutral-500">No invoices yet.</p>
            ) : (
              <ul className="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
                {allSales.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                    <a href={`/app/sales/${s.id}/pdf`} target="_blank" className="font-medium hover:underline">
                      {s.invoice_no}
                    </a>
                    <span className="text-neutral-500">{fmtDate(s.created_at)}</span>
                    <span>{s.status === "void" ? <Badge tone="red">void</Badge> : METHOD_LABEL[s.payment_method]}</span>
                    <span className="tabular-nums">{formatPula(Number(s.total))}</span>
                  </li>
                ))}
              </ul>
            )}
            {(quotes ?? []).length > 0 && (
              <>
                <h3 className="mb-2 mt-5 text-sm font-semibold">Quotations</h3>
                <ul className="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
                  {quotes!.map((q) => (
                    <li key={q.id} className="flex items-center justify-between gap-2 py-2">
                      <a href={`/app/quotations/${q.id}/pdf`} target="_blank" className="font-medium hover:underline">
                        {q.quote_no}
                      </a>
                      <span className="text-neutral-500">{fmtDate(q.created_at)}</span>
                      <Badge>{q.status}</Badge>
                      <span className="tabular-nums">{formatPula(Number(q.total))}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>

        <Card>
          <h2 className="mb-4 font-semibold">Details</h2>
          <CustomerForm
            customer={{ ...c, credit_limit: limit }}
            canSetLimit={hasRole(current.role, "manager")}
          />
        </Card>
      </div>
    </>
  );
}
