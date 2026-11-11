import Link from "next/link";
import { getSession, hasRole } from "@/lib/auth/session";
import { userClient } from "@/lib/db/user";
import { fmtDate } from "@/lib/format-date";
import { formatPula } from "@/lib/money";
import { Badge, buttonClass, Card, Input, PageHeader } from "@/components/ui";
import { CustomerForm } from "./customer-form";

export const metadata = { title: "Customers · Morekisi" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; add?: string }> }) {
  const { current } = await getSession();
  const { q = "", filter, add } = await searchParams;
  const db = await userClient();

  const [{ data: customers, error }, { data: balances }] = await Promise.all([
    db.from("customers").select("id, name, phone, company, tags, source, last_seen_at, credit_limit").eq("business_id", current.businessId).order("name"),
    db.from("customer_balances").select("customer_id, balance, oldest_unpaid").eq("business_id", current.businessId),
  ]);
  if (error) throw new Error(error.message);
  const balanceBy = new Map((balances ?? []).map((b) => [b.customer_id, b]));

  const needle = q.trim().toLowerCase();
  const rows = (customers ?? [])
    .map((c) => ({ ...c, balance: Number(balanceBy.get(c.id)?.balance ?? 0), oldest: balanceBy.get(c.id)?.oldest_unpaid ?? null }))
    .filter(
      (c) =>
        (!needle || [c.name, c.phone ?? "", c.company ?? "", (c.tags as string[]).join(" ")].some((v) => v.toLowerCase().includes(needle))) &&
        (filter !== "owing" || c.balance > 0),
    );
  if (filter === "owing") rows.sort((a, b) => b.balance - a.balance);
  const owed = rows.reduce((t, c) => t + Math.max(c.balance, 0), 0);

  return (
    <>
      <PageHeader
        title="Customers"
        description={`${rows.length} customers${owed > 0 ? ` · owed to you: ${formatPula(owed)}` : ""}`}
        actions={
          <Link href="/app/customers?add=1" className={buttonClass()}>
            Add customer
          </Link>
        }
      />

      {add && (
        <Card className="mb-6">
          <h2 className="mb-4 font-semibold">New customer</h2>
          <CustomerForm canSetLimit={hasRole(current.role, "manager")} />
        </Card>
      )}

      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} placeholder="Name, phone, company or tag" className="max-w-xs" />
        <select
          name="filter"
          defaultValue={filter ?? ""}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option value="">All</option>
          <option value="owing">Owe money</option>
        </select>
        <button className={buttonClass("secondary")}>Filter</button>
      </form>

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-500">No customers found. Customers are added automatically when they message your WhatsApp number or buy on credit.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <tr>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 text-right font-medium">Owes</th>
                <th className="px-4 py-3 font-medium">Owing since</th>
                <th className="px-4 py-3 font-medium">Last WhatsApp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rows.map((c) => {
                const over = Number(c.credit_limit) > 0 && c.balance > Number(c.credit_limit);
                return (
                  <tr key={c.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    <td className="px-4 py-3">
                      <Link href={`/app/customers/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      {c.company && <span className="block text-xs text-neutral-500">{c.company}</span>}
                      {c.tags.length > 0 && <span className="mt-1 flex gap-1">{(c.tags as string[]).map((t) => <Badge key={t}>{t}</Badge>)}</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-neutral-500">{c.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c.balance > 0 ? <Badge tone={over ? "red" : "amber"}>{formatPula(c.balance)}</Badge> : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{c.balance > 0 && c.oldest ? fmtDate(c.oldest) : "—"}</td>
                    <td className="px-4 py-3 text-neutral-500">{c.last_seen_at ? fmtDate(c.last_seen_at) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
