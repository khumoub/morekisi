# Morekisi — MVP Specification (v0.1)

*Your Business. Your WhatsApp. One Platform.*

**Scope decision:** The MVP is used by the **owner and staff only**. Customers do not talk to the bot yet.
**First market:** hardware shops and small wholesalers in Botswana.
**Stack:** Next.js (Vercel) · Supabase/Postgres · Meta WhatsApp Cloud API · LLM API (kept behind our own service so the provider can change).

---

## 1. Core principles

1. **The database is the source of truth. The AI only translates.** The LLM turns a message into a structured action and phrases replies. It never calculates totals, stock or profit. Postgres does all of that.
2. **Confirm before writing.** Every action that changes data (sale, stock in, payment) is shown back to the user as a summary with **Confirm / Cancel** buttons. Nothing is saved until the user taps Confirm.
3. **Stock is a ledger.** Stock levels are never edited directly. Every change is a row in `stock_movements`, and the current stock is the sum of those rows. This gives a full audit trail, so the owner can see exactly when stock went missing.
4. **Money is stored as integer thebe** (1 BWP = 100 thebe), so there are no floating-point rounding errors.
5. **Documents are numbered per business with no gaps** (INV-00001, QT-00001), which BURS/VAT compliance requires.
6. **Multi-tenant from day one.** Every row belongs to a `business_id` and is protected by Row Level Security.

---

## 2. Users and roles

| Role | WhatsApp | Dashboard |
|---|---|---|
| **Owner** | Everything | Everything, including cost prices, profit, staff management and settings |
| **Manager** | Everything except settings | Everything except billing and staff management |
| **Staff** | Record sales, check stock, create quotes, record payments | Sales and stock only. **No cost prices or profit.** |

A user is identified on WhatsApp by their phone number, which is registered in `business_users`. A message from a phone number we don't recognise gets a "this number isn't registered" reply, and nothing else happens.

---

## 3. WhatsApp: what the bot understands (MVP intents)

| Intent | Example message | Result |
|---|---|---|
| `record_sale` | "Sold 20 cement 42.5 and 5 rebar 12mm to Kabelo, credit" | Draft sale → confirm → invoice PDF sent |
| `create_quote` | "Quote for Tlotlo: 100 bricks, 10 cement" | Quotation PDF the user can forward to the customer |
| `convert_quote` | "QT-00012 accepted, cash" | Turns the quotation into a sale |
| `stock_in` | "Received 200 cement from Builders Depot at P78 each" | Stock movement plus new cost price |
| `stock_adjust` | "Remove 3 cement, damaged" | Adjustment with a reason (owner/manager only) |
| `check_stock` | "How much 12mm rebar do we have?" | Stock level and reorder warning |
| `check_price` | "Price of 6m IBR sheet?" | Selling price |
| `record_payment` | "Kabelo paid P500 Orange Money" | Payment recorded against Kabelo's account → new balance |
| `customer_balance` | "Who owes us?" / "Kabelo balance" | Debtors list or a single customer's balance |
| `report` | "Sales today" / "Profit this week" | Figures calculated by the database |
| `ask` | "Which product sold most this month?" | AI answers using **read-only** report functions |

### 3.1 Message pipeline

```
WhatsApp → Meta webhook → /api/whatsapp (Next.js)
  1. Verify the signature (X-Hub-Signature-256) and ignore duplicate messages (message id)
  2. Look up the sender's phone in business_users → business, role
  3. Log the message in wa_messages
  4. If there is an open pending_action and this is a button reply → execute it or cancel it
  5. Otherwise, the LLM (with tool calling) extracts the intent and its fields
  6. Match products and customers against the database (fuzzy: pg_trgm)
       - one confident match → continue
       - several possible matches → ask with a WhatsApp list ("Which cement? 1) 42.5N 50kg  2) 32.5N 50kg")
       - no match → "I don't know '<x>'. Add it as a new product?"
  7. Read-only intents → answer straight away
     Write intents → save a pending_action, send a summary with [Confirm] [Cancel]
  8. On Confirm → call a single Postgres function (e.g. create_sale) that does everything
     in one transaction → generate the PDF → send it as a WhatsApp document
```

Pending actions expire after 15 minutes. If the user sends a new message while a confirmation is open, it replaces the old one, after telling the user.

### 3.2 Example conversation

> **Staff:** sold 20 cement and 5 rebar 12 to kabelo on credit
> **Morekisi:** 🧾 *Sale — Kabelo Molefe (credit)*
> 20 × Cement 42.5N 50kg @ P95.00 = P1,900.00
> 5 × Rebar Y12 6m @ P120.00 = P600.00
> **Total P2,500.00** (incl. VAT P307.02)
> Kabelo's new balance: P3,150.00 (limit P5,000)
> [✅ Confirm] [❌ Cancel]
> **Staff:** ✅
> **Morekisi:** Saved as **INV-00231**. 📎 INV-00231.pdf
> ⚠️ Cement 42.5N is now at 34 bags (reorder level 50).

### 3.3 WhatsApp platform constraints to design around

- **The 24-hour window:** we can reply freely within 24 hours of the user's last message. Anything we send first (the daily report, low-stock alerts) after that window has closed must use a pre-approved **utility template**. Get these templates approved early:
  - `daily_summary` — "Today's sales at {{business}}: {{total}} from {{count}} sales. Profit {{profit}}. Reply REPORT for details."
  - `low_stock_alert`
- **MVP numbers:** one Morekisi number shared by all businesses (users are identified by their phone). When customer-facing ordering arrives in Phase 1.5, each business gets its own number through Meta Embedded Signup.
- **Voice notes (Phase 2):** they come in as audio media. The plan is speech-to-text and then the same pipeline as text.

---

## 4. Dashboard (Next.js)

| Screen | Contents |
|---|---|
| **Home** | Today/week/month: sales, gross profit, number of sales, cash vs credit vs mobile money, top products, low-stock list, top debtors |
| **Sales** | List and filter, view the invoice, void a sale (owner only, with a reason; creates reversing stock movements) |
| **Quotations** | List, status (open/accepted/expired), convert to sale |
| **Products** | Add/edit, CSV import (essential for onboarding: a shop may have 500+ SKUs), current stock, reorder level |
| **Stock** | Movement history per product, stock in, adjustments |
| **Customers** | List, balance, statement (invoices + payments), credit limit |
| **Reports** | Sales by day/product/staff member, profit, debtor ageing (0–30/31–60/61–90/90+), VAT summary |
| **Settings** | Business details, VAT number, invoice footer and bank details, staff and phone numbers, closing time for the daily report |

Login uses Supabase Auth with a phone OTP. Owners already live on WhatsApp and SMS, and many won't want yet another password.

---

## 5. Invoices and VAT

- The VAT rate is stored per business (`vat_rate_bp`, default **1400 = 14%**). `vat_registered = false` means invoices show no VAT.
- Prices are **VAT-inclusive by default** (that's how counter prices work in Botswana), and the VAT is extracted: `vat = total × rate / (1 + rate)`.
- Invoice fields: business name, address, VAT/TIN number, invoice number, date, customer, line items, subtotal excl. VAT, VAT, total, payment method, and bank/mobile money details for credit sales.
- PDFs are generated server-side (`@react-pdf/renderer`), stored in Supabase Storage and sent as a WhatsApp document.
- A sale is never deleted. It can only be **voided**: it is marked void, and reversing stock movements are created.

---

## 6. Data model

See `supabase/migrations/0001_init.sql`. Summary:

```
businesses ─┬─ business_users (owner/manager/staff, phone)
            ├─ products ── stock_movements (ledger) ──► product_stock (view)
            ├─ customers ─┬─ sales ── sale_items
            │             ├─ quotations ── quotation_items
            │             └─ payments          ──► customer_balances (view)
            ├─ doc_counters (gap-free INV/QT numbers)
            ├─ wa_messages (log)
            └─ pending_actions (awaiting confirmation)
```

Writes go through transactional functions: `create_sale`, `record_payment`, `stock_in`, `void_sale`. The app never inserts sale rows directly, so stock, totals and numbering can't get out of sync.

---

## 7. The AI layer

- It is one internal module, `lib/ai/`, with a single function: `interpret(message, context) → Intent`. Swapping the LLM provider means changing one file.
- The LLM receives: the user's role, the intent tool schemas, and a **short list of candidate products and customers** (pre-filtered by trigram search). It does **not** receive the whole catalogue.
- Its output is validated with Zod. If validation fails, the bot asks a clarifying question instead of guessing.
- For `ask` (free-form questions), the LLM can only call a fixed set of read-only report functions (`sales_summary`, `top_products`, `debtors`, `stock_levels`...). **It never gets raw SQL access.**
- Every interpretation is logged with the original message, so we can measure accuracy and build a test set from real shop language (mixed English/Setswana, abbreviations such as "12mm Y12 rebar", "cem").

---

## 8. Project structure

```
morekisi/
  app/
    (dashboard)/...            dashboard pages
    api/whatsapp/route.ts      webhook (GET verify, POST messages)
    api/cron/daily/route.ts    daily summaries (Vercel Cron)
  lib/
    whatsapp/                  send text/buttons/lists/documents, verify signature
    ai/                        interpret(), tool schemas, prompts
    intents/                   one handler per intent
    pdf/                       invoice + quote templates
    db/                        Supabase client, typed RPC wrappers
  supabase/migrations/
  tests/intents/               real-message test set → expected intent
```

---

## 9. Build plan (about 8 weeks, part-time)

| Week | Deliverable |
|---|---|
| 1 | Supabase schema + RLS, Next.js skeleton, auth, products CRUD + CSV import |
| 2 | WhatsApp webhook end to end: echo bot → identify user → `check_stock`, `check_price` |
| 3 | `record_sale` with confirmation, `create_sale` RPC, invoice PDF over WhatsApp |
| 4 | Customers, credit, `record_payment`, balances, `stock_in` |
| 5 | Quotations, convert to sale, daily summary template + cron |
| 6 | Dashboard home + reports, `ask` intent |
| 7 | **Pilot with 2–3 real hardware shops**: watch them use it, collect messages |
| 8 | Fix what the pilot reveals, improve intent accuracy, onboarding flow |

**MVP success metric:** pilot shops record **at least 80% of their sales through Morekisi for 2 weeks in a row** without being reminded.

---

## 10. Open questions

1. Meta Business verification: which legal entity registers the WhatsApp Business account (Morekisi Pty Ltd)? Start this **now**, because it can take weeks.
2. Pilot shops: who are the first 2–3 hardware shops? Their real product lists and message styles should shape week 2–3.
3. Pricing: proposed P299 / P599 / P999 per month by number of staff users and features. Validate this with the pilot shops.
4. Is Setswana support needed in bot *replies* at MVP, or only in understanding messages?
5. Will an owner ever share stock between two shops (multi-branch)? This is Phase 3, but `branch_id` is cheap to add now. **Recommendation: add the column now, but don't build the UI yet.**
