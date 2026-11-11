import { ActionForm } from "@/components/action-form";
import { Field, Input, Textarea } from "@/components/ui";
import { saveCustomer } from "../records-actions";

export interface CustomerFormValues {
  id: string;
  name: string;
  phone: string | null;
  company: string | null;
  credit_limit: number;
  tags: string[];
  notes: string | null;
}

export function CustomerForm({ customer, canSetLimit }: { customer?: CustomerFormValues; canSetLimit: boolean }) {
  return (
    <ActionForm action={saveCustomer} submitLabel={customer ? "Save" : "Add customer"}>
      {customer && <input type="hidden" name="id" value={customer.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input name="name" defaultValue={customer?.name} placeholder="Kabelo Molefe" required />
        </Field>
        <Field label="WhatsApp number" hint="So the bot recognises them when they message the shop.">
          <Input name="phone" type="tel" defaultValue={customer?.phone ?? ""} placeholder="71 234 567" />
        </Field>
        <Field label="Company">
          <Input name="company" defaultValue={customer?.company ?? ""} placeholder="Optional" />
        </Field>
        {canSetLimit && (
          <Field label="Credit limit (P)" hint="0 = no limit set. Staff are warned when a sale goes over it.">
            <Input name="credit_limit" inputMode="decimal" defaultValue={customer ? (customer.credit_limit / 100).toFixed(2) : "0"} />
          </Field>
        )}
        <Field label="Tags" hint="Comma-separated, e.g. builder, contractor, VIP">
          <Input name="tags" defaultValue={customer?.tags.join(", ")} />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea name="notes" rows={2} defaultValue={customer?.notes ?? ""} />
      </Field>
    </ActionForm>
  );
}
