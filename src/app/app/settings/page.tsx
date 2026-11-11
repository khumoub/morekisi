import { requireRole } from "@/lib/auth/session";
import { userClient } from "@/lib/db/user";
import { formatDeliveryAreas, type DeliveryArea } from "@/lib/delivery-areas";
import { ActionForm } from "@/components/action-form";
import { Card, Checkbox, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { saveSettings } from "./actions";

export const metadata = { title: "Shop settings · Morekisi" };

export default async function SettingsPage() {
  const { current } = await requireRole("owner");
  const db = await userClient();
  const { data: b, error } = await db.from("businesses").select("*").eq("id", current.businessId).single();
  if (error) throw new Error(error.message);

  return (
    <>
      <PageHeader title="Shop settings" description="These details appear on invoices, quotations and in your WhatsApp shop." />
      <ActionForm action={saveSettings} submitLabel="Save settings" className="space-y-6">
        <Card>
          <h2 className="mb-4 font-semibold">Shop details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Shop name">
              <Input name="name" defaultValue={b.name} required />
            </Field>
            <Field label="Registered / trading name" hint="If different, e.g. Molefe Holdings (Pty) Ltd">
              <Input name="trading_name" defaultValue={b.trading_name ?? ""} />
            </Field>
            <Field label="Address">
              <Input name="address" defaultValue={b.address ?? ""} placeholder="Plot 123, Broadhurst, Gaborone" />
            </Field>
            <Field label="Phone">
              <Input name="phone" defaultValue={b.phone ?? ""} />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" defaultValue={b.email ?? ""} />
            </Field>
            <Field label="Shop link" hint="Your public shop page (coming in Phase 2)">
              <Input value={`morekisi.shop/${b.slug}`} readOnly className="text-neutral-500" />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold">VAT and invoices</h2>
          <div className="space-y-4">
            <Checkbox name="vat_registered" label="VAT registered (14%)" defaultChecked={b.vat_registered} />
            <Field label="VAT number">
              <Input name="vat_number" defaultValue={b.vat_number ?? ""} placeholder="P01234567890" className="max-w-xs" />
            </Field>
            <Checkbox name="prices_include_vat" label="My prices include VAT" defaultChecked={b.prices_include_vat} />
            <Field label="Invoice footer" hint="Bank and mobile money details for customers paying later.">
              <Textarea
                name="invoice_footer"
                rows={3}
                defaultValue={b.invoice_footer ?? ""}
                placeholder={"FNB Botswana · Acc 62000000000 · Branch 280267\nOrange Money: 71 234 567"}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold">WhatsApp shop</h2>
          <div className="space-y-4">
            <Field label="Welcome message" hint="The first thing customers see. Leave empty for the default.">
              <Textarea
                name="welcome_message"
                rows={2}
                defaultValue={b.welcome_message ?? ""}
                placeholder={`Welcome to ${b.name} 👋 Browse our products, ask for a quotation or chat to our team.`}
              />
            </Field>
            <Checkbox
              name="require_order_approval"
              label="Staff approve every customer order before it's confirmed (recommended)"
              defaultChecked={b.require_order_approval}
            />
            <Field label="Delivery areas and fees" hint='One per line, e.g. "Tlokweng = 150" or "Block 8 = free".'>
              <Textarea
                name="delivery_areas"
                rows={4}
                defaultValue={formatDeliveryAreas((b.delivery_areas ?? []) as DeliveryArea[])}
                placeholder={"Tlokweng = 150\nMogoditshane = 200"}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold">Owner controls</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Credit sales above this need your approval (P)">
              <Input
                name="credit_approval_limit"
                inputMode="decimal"
                defaultValue={(Number(b.credit_approval_limit) / 100).toFixed(2)}
              />
            </Field>
            <Field label="Evening summary time" hint="When we send you the day's sales on WhatsApp.">
              <Input name="daily_report_time" type="time" defaultValue={String(b.daily_report_time).slice(0, 5)} />
            </Field>
          </div>
        </Card>
      </ActionForm>
    </>
  );
}
