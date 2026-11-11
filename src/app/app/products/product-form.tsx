import { ActionForm } from "@/components/action-form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import type { ProductRow } from "./data";
import { saveProduct } from "./actions";

const pula = (thebe: number | null | undefined) => (thebe == null ? "" : (thebe / 100).toFixed(2));

export function ProductForm({
  product,
  categories,
}: {
  product?: ProductRow;
  categories: { id: string; name: string }[];
}) {
  const isNew = !product;
  return (
    <ActionForm action={saveProduct} submitLabel={isNew ? "Add product" : "Save changes"}>
      {product && <input type="hidden" name="id" value={product.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product name">
          <Input name="name" defaultValue={product?.name} placeholder="Cement 42.5N 50kg" required />
        </Field>
        <Field label="Code / SKU" hint="Optional. Used to match products when importing.">
          <Input name="sku" defaultValue={product?.sku ?? ""} placeholder="CEM425" />
        </Field>
        <Field label="Category">
          <Select name="category_id" defaultValue={product?.category_id ?? ""}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="…or a new category">
          <Input name="new_category" placeholder="e.g. Plumbing" />
        </Field>
        <Field label="Selling price (P)" hint={'Including VAT, as on the shelf. "95" or "95.00".'}>
          <Input name="sell_price" inputMode="decimal" defaultValue={pula(product?.sell_price)} placeholder="95.00" required />
        </Field>
        <Field label="Cost price (P)" hint="Excluding VAT. Only owners and managers can see this.">
          <Input name="cost_price" inputMode="decimal" defaultValue={pula(product?.cost_price)} placeholder="78.00" />
        </Field>
        <Field label="Unit" hint="bag, each, m, kg, sheet, litre…">
          <Input name="unit" defaultValue={product?.unit ?? "each"} />
        </Field>
        <Field label="Reorder level" hint="Warn me when available stock drops to this.">
          <Input name="reorder_level" inputMode="decimal" defaultValue={product?.reorder_level ?? ""} placeholder="50" />
        </Field>
        {isNew && (
          <Field label="Opening stock" hint="How many you have right now.">
            <Input name="opening_stock" inputMode="decimal" placeholder="120" />
          </Field>
        )}
        <Field label="Other names" hint="Comma-separated words staff and customers use, e.g. cem, 42.5">
          <Input name="aliases" defaultValue={product?.aliases.join(", ")} />
        </Field>
      </div>
      <Field label="Description" hint="Shown to customers in the WhatsApp shop.">
        <Textarea name="description" rows={2} defaultValue={product?.description ?? ""} />
      </Field>
      <div className="flex flex-wrap gap-6">
        <Checkbox name="show_in_shop" label="Show in the WhatsApp shop" defaultChecked={product?.show_in_shop ?? true} />
        {!isNew && <Checkbox name="active" label="Active" defaultChecked={product.active} />}
      </div>
    </ActionForm>
  );
}
