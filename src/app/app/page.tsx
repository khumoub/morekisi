import Link from "next/link";
import { getSession, hasRole } from "@/lib/auth/session";
import { userClient } from "@/lib/db/user";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "Home · Morekisi" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { current } = await getSession();
  const { denied } = await searchParams;
  const db = await userClient();
  const biz = current.businessId;

  const [products, lowStock, pendingOrders, customers, wa, staff] = await Promise.all([
    db.from("products").select("id", { count: "exact", head: true }).eq("business_id", biz).eq("active", true),
    db.from("product_stock").select("product_id, name, available, unit").eq("business_id", biz).eq("low_stock", true).limit(8),
    db.from("orders").select("id", { count: "exact", head: true }).eq("business_id", biz).eq("status", "pending_approval"),
    db.from("customers").select("id", { count: "exact", head: true }).eq("business_id", biz),
    db.from("wa_accounts").select("display_phone").eq("business_id", biz).eq("active", true).maybeSingle(),
    db.from("business_users").select("id", { count: "exact", head: true }).eq("business_id", biz).eq("active", true),
  ]);

  const isOwner = hasRole(current.role, "owner");
  const steps = [
    { done: (products.count ?? 0) > 0, label: "Add your products", href: "/app/products/import", cta: "Import a spreadsheet" },
    { done: !!wa.data, label: "Connect your WhatsApp number", href: "/app/settings/whatsapp", cta: "Connect", owner: true },
    { done: (staff.count ?? 0) > 1, label: "Add your staff", href: "/app/settings/staff", cta: "Add staff", owner: true },
  ].filter((s) => !s.owner || isOwner);
  const remaining = steps.filter((s) => !s.done);

  const stats = [
    { label: "Products", value: products.count ?? 0, href: "/app/products" },
    { label: "Low stock", value: lowStock.data?.length ?? 0, href: "/app/products?filter=low" },
    { label: "Orders to approve", value: pendingOrders.count ?? 0 },
    { label: "Customers", value: customers.count ?? 0 },
  ];

  return (
    <>
      <PageHeader title={`Dumela, ${current.name.split(" ")[0]}`} description={current.businessName} />
      {denied && (
        <div className="mb-6">
          <Notice tone="error">That page is only available to the shop owner.</Notice>
        </div>
      )}

      {remaining.length > 0 && (
        <Card className="mb-6">
          <h2 className="font-semibold">Get your shop ready</h2>
          <ul className="mt-3 space-y-2">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-3 text-sm">
                <span className={s.done ? "text-neutral-400 line-through" : ""}>
                  {s.done ? "✅" : "⬜"} {s.label}
                </span>
                {!s.done && (
                  <Link href={s.href} className="font-medium text-emerald-700 underline">
                    {s.cta}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => {
          const body = (
            <Card>
              <p className="text-sm text-neutral-500">{s.label}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{s.value}</p>
            </Card>
          );
          return s.href ? (
            <Link key={s.label} href={s.href}>
              {body}
            </Link>
          ) : (
            <div key={s.label}>{body}</div>
          );
        })}
      </div>

      {(lowStock.data?.length ?? 0) > 0 && (
        <Card className="mt-6">
          <h2 className="font-semibold">Running low</h2>
          <ul className="mt-3 divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
            {lowStock.data!.map((p) => (
              <li key={p.product_id} className="flex justify-between py-2">
                <Link href={`/app/products/${p.product_id}`} className="hover:underline">
                  {p.name}
                </Link>
                <Badge tone={Number(p.available) <= 0 ? "red" : "amber"}>
                  {Number(p.available)} {p.unit}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {wa.data && (
        <p className="mt-6 text-sm text-neutral-500">
          WhatsApp connected: <span className="font-medium">{wa.data.display_phone}</span>
        </p>
      )}
    </>
  );
}
