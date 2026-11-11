# Morekisi

*Your Business. Your WhatsApp. One Platform.*

Morekisi turns a shop's WhatsApp number into its **online shop**, its **customer book (CRM)** and its **back office (ERP)**. Customers browse, ask for quotes and order on WhatsApp. Staff record sales, stock and payments on WhatsApp. The owner sees everything on a dashboard.

The first market is hardware shops and small wholesalers in Botswana. See [`SPEC.md`](SPEC.md) for the full product specification and build plan.

## Status: Phase 1, week 2

| Done | |
|---|---|
| ✅ Database: products, stock ledger, customers, sales, quotations, payments, orders with approval, reserved stock, cash-up, conversations, RLS | `supabase/migrations/0001–0003` |
| ✅ WhatsApp webhook, message routing (staff → back office, customers → storefront), bot/person handover | `src/app/api/whatsapp`, `src/lib/engine` |
| ✅ Back office: `stock …`, `price …`. Storefront: menu, catalogue, product questions, quote requests | `src/lib/office`, `src/lib/store` |
| ✅ **Dashboard sign-in** with phone number + one-time code, delivered on WhatsApp (Supabase Send SMS hook) | `src/app/login`, `src/app/api/auth/whatsapp-otp` |
| ✅ **Onboarding**: create a shop and become its owner; staff are linked automatically when they first sign in | `src/app/onboarding`, `0004_dashboard.sql` |
| ✅ **Roles enforced in the database**: only owners/managers edit products and see cost prices; only owners change settings, staff and WhatsApp; the stock ledger can't be edited | `0004_dashboard.sql` |
| ✅ **Products**: list, search, low-stock filter, add/edit, stock correction with reason, movement history | `src/app/app/products` |
| ✅ **Spreadsheet import** with column auto-detection, line-by-line problems, preview; re-import updates prices and sets stock to the count | `src/lib/csv`, `src/app/app/products/import` |
| ✅ **Settings**: shop details, VAT and invoice footer, welcome message, order approval, delivery areas and fees, owner controls | `src/app/app/settings` |
| ✅ **Staff**: add by phone with a role, change roles, remove access (can't remove yourself or the last owner) | `src/app/app/settings/staff` |
| ✅ **WhatsApp connection** per shop; access tokens stored encrypted in Supabase Vault | `src/app/app/settings/whatsapp` |
| ⏭️ Next: AI message understanding; recording sales by WhatsApp with Confirm/Cancel; invoice PDFs | week 3 |

## Getting started

```bash
npm install
cp .env.example .env.local      # fill in Supabase + Meta values
npm run dev
```

1. **Supabase:** create a project and run the files in `supabase/migrations/` in order (SQL editor or `supabase db push`).
   - Authentication → Providers → **Phone**: enable it.
   - To send login codes on WhatsApp instead of SMS: Authentication → Hooks → **Send SMS hook** → HTTPS → `https://<your-domain>/api/auth/whatsapp-otp`, and put the generated secret in `SUPABASE_SEND_SMS_HOOK_SECRET`. This needs an approved WhatsApp *authentication* template (default name `morekisi_login_code`) on the Morekisi platform number.
2. **Meta:** create an app with the WhatsApp product, then point the webhook to `https://<your-domain>/api/whatsapp` using `WHATSAPP_VERIFY_TOKEN`, and subscribe to the `messages` field.
3. **Your shop:** sign in at `/login`, create your shop, import products, add staff, then connect your number under **WhatsApp**.

## Tests

```bash
npm test            # unit + engine tests (no database needed)
npm run test:db     # all migrations + end-to-end business flows on a throwaway Postgres 16
npm run typecheck
```

## Stack

Next.js 15 (Vercel) · Supabase / PostgreSQL · Meta WhatsApp Cloud API · LLM API (from week 3)
