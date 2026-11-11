import Link from "next/link";
import { getSession, hasRole } from "@/lib/auth/session";
import { formatPula } from "@/lib/money";
import { Badge, buttonClass, Card, Input, PageHeader } from "@/components/ui";
import { loadProducts } from "./data";

export const metadata = { title: "Products · Morekisi" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const { current } = await getSession();
  const { q = "", filter } = await searchParams;
  const canEdit = hasRole(current.role, "manager");
  const all = await loadProducts(current.businessId, canEdit);

  const needle = q.trim().toLowerCase();
  const products = all.filter((p) => {
    const matchesSearch =
      !needle ||
      p.name.toLowerCase().includes(needle) ||
      (p.sku ?? "").toLowerCase().includes(needle) ||
      (p.category ?? "").toLowerCase().includes(needle);
    if (!matchesSearch) return false;
    switch (filter) {
      case "all":
        return true;
      case "inactive":
        return !p.active;
      case "low":
        return p.active && p.track_stock && p.low_stock;
      default:
        return p.active;
    }
  });

  return (
    <>
      <PageHeader
        title="Products"
        description={`${all.filter((p) => p.active).length} active products`}
        actions={
          canEdit && (
            <>
              <Link href="/app/products/import" className={buttonClass("secondary")}>
                Import spreadsheet
              </Link>
              <Link href="/app/products/new" className={buttonClass()}>
                Add product
              </Link>
            </>
          )
        }
      />

      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} placeholder="Search name, code or category" className="max-w-xs" />
        <select
          name="filter"
          defaultValue={filter ?? ""}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option value="">Active</option>
          <option value="low">Low stock</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <button className={buttonClass("secondary")}>Filter</button>
      </form>

      {products.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-500">
            {all.length === 0 ? (
              <>
                No products yet.{" "}
                {canEdit && (
                  <Link href="/app/products/import" className="font-medium text-emerald-700 underline">
                    Import your product list
                  </Link>
                )}
              </>
            ) : (
              "No products match your search."
            )}
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <tr>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
                {canEdit && <th className="px-4 py-3 text-right font-medium">Cost</th>}
                <th className="px-4 py-3 text-right font-medium">Available</th>
                <th className="px-4 py-3 font-medium">Shop</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                  <td className="px-4 py-3">
                    <Link href={`/app/products/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    {p.sku && <span className="ml-2 text-xs text-neutral-400">{p.sku}</span>}
                    {!p.active && (
                      <span className="ml-2">
                        <Badge>inactive</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-500">{p.category ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatPula(p.sell_price)}
                    <span className="text-neutral-400"> /{p.unit}</span>
                  </td>
                  {canEdit && <td className="px-4 py-3 text-right tabular-nums text-neutral-500">{formatPula(p.cost_price ?? 0)}</td>}
                  <td className="px-4 py-3 text-right tabular-nums">
                    {!p.track_stock ? (
                      <span className="text-neutral-400">n/a</span>
                    ) : p.low_stock ? (
                      <Badge tone={p.available <= 0 ? "red" : "amber"}>{p.available}</Badge>
                    ) : (
                      p.available
                    )}
                    {p.reserved > 0 && <span className="block text-xs text-neutral-400">{p.reserved} reserved</span>}
                  </td>
                  <td className="px-4 py-3">{p.show_in_shop ? <Badge tone="green">shown</Badge> : <Badge>hidden</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
