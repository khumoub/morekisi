# Morekisi

*Your Business. Your WhatsApp. One Platform.*

Morekisi turns a shop's WhatsApp number into its **online shop**, its **customer book (CRM)** and its **back office (ERP)**. Customers browse, ask for quotes and order on WhatsApp. Staff record sales, stock and payments on WhatsApp. The owner sees everything on a dashboard.

The first market is hardware shops and small wholesalers in Botswana. See [`SPEC.md`](SPEC.md) for the full product specification and build plan.

## Status: Phase 1, week 1

| Done | |
|---|---|
| ✅ Database schema: products, stock ledger, customers, sales, quotations, payments, orders with approval, reserved stock, cash-up, conversations, RLS | `supabase/migrations/` |
| ✅ WhatsApp webhook: Meta verification, signature check, fast 200 + background processing, duplicate protection | `src/app/api/whatsapp/route.ts` |
| ✅ Message routing: staff → back office, customers → storefront, bot/person handover, `/shop` test mode | `src/lib/engine/` |
| ✅ Back office: `stock …`, `price …`, help | `src/lib/office/` |
| ✅ Storefront: welcome menu, catalogue, product questions answered from the database, quote requests, talk to a person | `src/lib/store/` |
| ✅ WhatsApp client: text, buttons, lists, documents, location request, enforcing Meta's limits | `src/lib/whatsapp/` |
| ⏭️ Next: dashboard login, product management and CSV import, per-shop WhatsApp tokens | week 2 |

## Getting started

```bash
npm install
cp .env.example .env.local      # fill in Supabase + Meta values
npm run dev
```

1. **Supabase:** create a project and run the files in `supabase/migrations/` in order (SQL editor or `supabase db push`).
2. **Meta:** create an app with the WhatsApp product, then point the webhook to `https://<your-domain>/api/whatsapp` using `WHATSAPP_VERIFY_TOKEN`, and subscribe to the `messages` field.
3. **Connect a shop:** insert a row into `wa_accounts` with the shop's `phone_number_id` and `waba_id`, and add staff phone numbers to `business_users`. The dashboard will do this from week 2.

## Tests

```bash
npm test            # unit + engine tests (no database needed)
npm run test:db     # all migrations + end-to-end business flows on a throwaway Postgres 16
npm run typecheck
```

## Stack

Next.js 15 (Vercel) · Supabase / PostgreSQL · Meta WhatsApp Cloud API · LLM API (from week 3)
