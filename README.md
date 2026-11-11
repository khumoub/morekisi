# Morekisi

*Your Business. Your WhatsApp. One Platform.*

Morekisi turns a shop's WhatsApp number into its **online shop**, its **customer book (CRM)** and its **back office (ERP)**. Customers browse, ask for quotes and order on WhatsApp. Staff record sales, stock and payments on WhatsApp. The owner sees everything on a dashboard.

The first market is hardware shops and small wholesalers in Botswana. See [`SPEC.md`](SPEC.md) for the full product specification and build plan.

## Status: Phase 1, week 3

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
| ✅ **AI understands staff messages** in everyday English and Setswana (sales, payments, stock in, stock/price checks, balances, reports, open questions, yes/no). Works with Claude, OpenAI or DeepSeek; keyword fallback if the AI is off or down | `src/lib/ai` |
| ✅ **Sales on WhatsApp**: products and customers matched against the shop's data, asks "which one?" when unsure, summary with **Confirm / Cancel**, stock and credit-limit warnings, discount limit for staff | `src/lib/office` |
| ✅ **Invoice PDFs** (tax invoice with VAT breakdown) sent straight back in the chat | `src/lib/pdf` |
| ✅ **Payments and stock in** on WhatsApp with confirmation; receipts numbered RCPT-… | `src/lib/office/flows.ts` |
| ✅ **Reports and questions**: "sales today", "who owes us", "what sold best this month?". Answers come only from real data; staff never see profit | `src/lib/office/answers.ts` |
| ⏭️ Next: quotations on WhatsApp, customer accounts and statements | week 4 |

## Run it locally with Docker (recommended)

You only need [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running) and [Git](https://git-scm.com).

```bash
git clone https://github.com/khumoub/morekisi.git
cd morekisi
docker compose up
```

The first start takes a few minutes (it downloads images and installs packages). When the log shows `Ready`, open **http://localhost:3000/login** and sign in:

| Phone | Who | Code |
|---|---|---|
| 71 234 567 | Neo Molefe, owner of *Demo Hardware* | 123456 |
| 71 234 568 | Kago Sello, staff | 123456 |
| 71 234 569 | not in any shop (try creating your own) | 123456 |

What runs: a minimal Supabase (Postgres, sign-in, database API) behind one gateway at `http://localhost:8000`, a one-off job that applies `supabase/migrations` and loads the demo shop (`supabase/seed.sql`), and the app with live reload: edit a file and the page updates.

```bash
docker compose down        # stop (your data is kept)
docker compose down -v     # stop and wipe local data (the demo shop is recreated next start)
docker compose logs -f app # app logs
```

- **"port is already allocated"**: something else on your computer uses that port. Morekisi needs **3000** (app) and **8000** (local Supabase); the database port (default **54329**) can be changed, e.g. `MOREKISI_DB_PORT=54400 docker compose up` (PowerShell: `$env:MOREKISI_DB_PORT=54400; docker compose up`). If you also use the Supabase CLI, stop it first with `npx supabase stop`.
- **AI and other settings:** create `.env.local` (copy `.env.example`); it's passed to the app. Restart with `docker compose up -d app`.
- **Database tools:** Postgres is on `localhost:54329` (user `postgres`, password in `docker/local.env`).
- `docker/local.env` holds **local-only** keys. They are not secrets; never use them for a real project.
- The WhatsApp bot needs Meta to reach your computer over the internet (e.g. via `ngrok http 3000`) and a Meta app. Without that, run the bot test against the local stack: `npm run test:integration`.

## Deploying (Supabase cloud + Vercel)

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
npm run test:integration  # WhatsApp → engine → local Supabase (needs `docker compose up -d`)
npm run eval:ai     # how well the real AI understands ~40 real-style shop messages (calls the model; costs a few cents)
```

## Stack

Next.js 15 (Vercel) · Supabase / PostgreSQL · Meta WhatsApp Cloud API · LLM API (from week 3)
