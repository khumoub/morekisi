import { notFound } from "next/navigation";
import { getSession, hasRole } from "@/lib/auth/session";
import { userClient } from "@/lib/db/user";
import { formatPula } from "@/lib/money";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, Input, PageHeader } from "@/components/ui";
import { adjustStock } from "../actions";
import { loadCategories, loadProducts } from "../data";
import { ProductForm } from "../product-form";

export const metadata = { title: "Product · Morekisi" };

const MOVEMENT_LABEL: Record<string, string> = {
  opening: "Opening stock",
  purchase: "Stock in",
  sale: "Sale",
  adjustment: "Adjustment",
  return: "Return",
  void: "Voided sale",
};

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { current } = await getSession();
  const canEdit = hasRole(current.role, "manager");

  const [product] = await loadProducts(current.businessId, canEdit, [id]);
  if (!product) notFound();

  const db = await userClient();
  const [categories, movements] = await Promise.all([
    loadCategories(current.businessId),
    db
      .from("stock_movements")
      .select("id, qty, type, reason, supplier, created_at, business_users(name), sales(invoice_no)")
      .eq("product_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  return (
    <>
      <PageHeader
        title={product.name}
        description={`${formatPula(product.sell_price)} / ${product.unit}${product.category ? ` · ${product.category}` : ""}`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {canEdit ? (
            <Card>
              <ProductForm product={product} categories={categories} />
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-neutral-500">Only owners and managers can edit products.</p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="font-semibold">Stock</h2>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                ["On hand", product.on_hand],
                ["Reserved", product.reserved],
                ["Available", product.available],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs text-neutral-500">{label}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {product.low_stock && (
              <p className="mt-3">
                <Badge tone="amber">At or below reorder level ({product.reorder_level})</Badge>
              </p>
            )}
          </Card>

          {canEdit && product.track_stock && (
            <Card>
              <h2 className="mb-3 font-semibold">Correct stock</h2>
              <ActionForm action={adjustStock} submitLabel="Update stock" variant="secondary">
                <input type="hidden" name="product_id" value={product.id} />
                <Field label="Quantity you counted">
                  <Input name="counted" inputMode="decimal" defaultValue={product.on_hand} required />
                </Field>
                <Field label="Reason">
                  <Input name="reason" placeholder="Stock take, damaged, theft…" required />
                </Field>
              </ActionForm>
            </Card>
          )}

          <Card>
            <h2 className="font-semibold">History</h2>
            {(movements.data ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">No stock movements yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
                {movements.data!.map((m) => {
                  const who = (m.business_users as unknown as { name: string } | null)?.name;
                  const invoice = (m.sales as unknown as { invoice_no: string } | null)?.invoice_no;
                  const q = Number(m.qty);
                  return (
                    <li key={m.id} className="flex justify-between gap-2 py-2">
                      <div>
                        <p>
                          {MOVEMENT_LABEL[m.type] ?? m.type}
                          {invoice && <span className="text-neutral-400"> · {invoice}</span>}
                        </p>
                        <p className="text-xs text-neutral-400">
                          {new Date(m.created_at).toLocaleString("en-BW", { dateStyle: "medium", timeStyle: "short" })}
                          {who && ` · ${who}`}
                          {(m.reason || m.supplier) && ` · ${m.reason ?? m.supplier}`}
                        </p>
                      </div>
                      <span className={`tabular-nums font-medium ${q < 0 ? "text-red-700" : "text-emerald-700"}`}>
                        {q > 0 ? `+${q}` : q}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
