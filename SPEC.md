# Morekisi — Product Specification (v0.2)

*Your Business. Your WhatsApp. One Platform.*

> **Morekisi turns your WhatsApp into your shop, your customer book and your back office.**
> Customers order and pay on WhatsApp. Staff record sales and stock on WhatsApp. The owner sees everything, everywhere.

**First market:** hardware shops and small wholesalers in Botswana.
**Stack:** Next.js (Vercel) · Supabase/Postgres · Meta WhatsApp Cloud API · LLM API (kept behind our own service so the provider can change).

---

## 1. Product model: one number, two kinds of user

Each shop connects **its own WhatsApp Business number** to Morekisi. Every incoming message is sent to a different place depending on who wrote it:

```
                    ┌──────────── Shop's WhatsApp number ────────────┐
 Customer writes ──►│  STOREFRONT + CRM                              │
                    │  browse catalogue, order, quote, pay, track    │
                    ├────────────────────────────────────────────────┤
 Staff/owner    ──► │  BACK OFFICE (ERP)                             │
 (known numbers)    │  sales, stock, approvals, cash-up, reports     │
                    └──────────────────────┬─────────────────────────┘
                                           ▼
                            One database ──► Owner dashboard (web)
```

- A **known phone number** (one registered in `business_users` for that shop) gets back-office mode.
- **Any other number** gets storefront mode, and a customer record is created for it automatically.
- Staff can switch to customer mode to test the shop ("/shop") and back again ("/office").

---

## 2. Core principles

1. **The database is the source of truth. The AI only translates.** The LLM turns a message into a structured action and phrases replies. It never calculates totals, stock or profit, and it never invents prices or stock.
2. **Confirm before writing.** Every back-office action that changes data is shown back with **Confirm / Cancel** buttons first.
3. **Customer orders wait for staff approval in Phase 1.** The storefront bot collects orders and quote requests. A person approves them before the customer receives a binding price or confirmation. The bot can never give discounts.
4. **Stock is a ledger.** Every change is a row in `stock_movements`, and stock on hand is the sum of those rows.
5. **Money is stored as integer thebe** (1 BWP = 100 thebe).
6. **Documents are numbered per business with no gaps** (INV, QT, ORD, RCPT), for BURS/VAT compliance. Nothing is ever deleted. Records are voided or cancelled, with a reason.
7. **Multi-tenant from day one.** Every row has a `business_id` and is protected by Row Level Security.
8. **Escape hatch to a person.** "Talk to a person", or any message the bot isn't confident about, goes to the staff inbox.

---

## 3. Modules

### 3.1 Storefront (customers)
| Feature | Phase |
|---|---|
| Welcome menu: Browse · Order again · Request quote · My account · Talk to a person | 1 |
| Catalogue browsing (categories → WhatsApp list messages), in-stock items only | 1 |
| Cart via chat ("add 10 cement") and via a WhatsApp **Flow** order form | 1 |
| Delivery or collection, delivery address or shared location | 1 |
| Order placed → **staff approval** → customer gets the confirmed order or quotation PDF | 1 |
| AI answers product questions from real stock and prices ("do you have 12mm rebar?") | 1 |
| Order status updates (confirmed / ready / out for delivery / delivered) | 1 |
| My account: balance, recent invoices, statement PDF | 1 |
| Payment links (Orange Money, MyZaka, Smega, card via gateway) with automatic matching | 2 |
| Lay-bye (pay in instalments, collect when fully paid) | 2 |
| Public shop page `morekisi.shop/<slug>` whose buttons open WhatsApp | 2 |
| Click-to-WhatsApp ad tracking | 2 |
| Loyalty points or stamp card | 3 |

### 3.2 CRM
| Feature | Phase |
|---|---|
| Automatic customer profile from the first message (name from the WhatsApp profile) | 1 |
| Customer timeline: messages, orders, invoices, payments | 1 |
| Tags and segments (builder, contractor, walk-in, VIP) | 1 |
| **Inbox**: staff reply to customers from the dashboard, with handover between bot and person | 1 |
| Reminders for money owed, with a payment link | 2 |
| Broadcast promotions to segments (marketing templates), tracking who bought afterwards | 2 |
| Rating after delivery, and repeat-purchase follow-ups | 3 |

### 3.3 Back office (ERP)
| Feature | Phase |
|---|---|
| Sales, invoices, VAT (spec v0.1) | 1 |
| Stock: stock in, adjustments, low-stock alerts | 1 |
| Quotations → sale | 1 |
| Customer credit, payments, statements, debtor ageing | 1 |
| **Order approval queue** (accept / edit / reject customer orders) | 1 |
| **Daily cash-up**: declared cash, card and mobile money vs recorded takings → difference flagged to the owner | 1 |
| Suppliers, purchase orders sent to the supplier on WhatsApp, goods received | 2 |
| Deliveries: assign a driver, driver updates by WhatsApp, photo as proof of delivery | 2 |
| Expenses (with an AI-read receipt photo) | 3 |
| Stock counts over WhatsApp | 3 |
| Staff clock-in, sales per staff member, commission | 3 |
| Branches and stock transfers | 3 |
| Accounting export | 3 |

### 3.4 Owner's assistant
| Feature | Phase |
|---|---|
| Evening summary (template message) | 1 |
| Approvals on WhatsApp: customer orders, voids, discounts over a set limit, large credit sales | 1 |
| Questions in plain language ("profit this week?", "who owes most?") | 1 |
| Morning brief | 2 |
| Voice notes (speech-to-text → same pipeline) | 2 |
| Unusual-activity alerts (voids, cash shortfalls, a big customer gone quiet) | 3 |

### 3.5 Network (Phase 4)
Financing from real sales data (with the shop's consent), a supplier network between wholesalers and retailers, a "near me" marketplace, and margin benchmarks.

---

## 4. Users and roles

| Role | WhatsApp | Dashboard |
|---|---|---|
| **Owner** | Everything, including approvals | Everything, including costs, profit, staff, settings, billing |
| **Manager** | Everything except settings | Everything except billing and staff management |
| **Staff** | Sales, stock checks, quotes, payments, order handling, cash-up | Sales, orders, inbox, stock. **No cost prices or profit.** |
| **Driver** (Phase 2) | Assigned deliveries only | — |
| **Customer** | Storefront | Optional web shop page |

---

## 5. Message pipeline

```
Meta webhook → POST /api/whatsapp
 1. Verify the X-Hub-Signature-256 signature, reply 200 quickly, process asynchronously
 2. Find the shop by phone_number_id (wa_accounts) → business
 3. Ignore duplicates (wa_message_id unique), log the message
 4. Sender is a business_users member? → BACK OFFICE handler
                                  else → STOREFRONT handler (get or create the customer)
 5. Is a human handling this conversation? → just store it, notify the inbox, no bot reply
 6. Button or list reply → continue the open flow (cart, pending_action, approval)
 7. Free text → AI interpret() → intent + fields (validated with Zod)
 8. Match products/customers in the database (pg_trgm); ask the user to choose if ambiguous
 9. Read-only → reply. Write → pending_action + Confirm/Cancel (back office)
                               or order → approval queue (storefront)
10. Run it in one Postgres function → PDF → send the document
```

### Back-office message types (Phase 1)
`record_sale`, `create_quote`, `convert_quote`, `stock_in`, `stock_adjust`, `check_stock`, `check_price`, `record_payment`, `customer_balance`, `report`, `cash_up`, `approve_order` / `reject_order`, `ask`.

### Storefront message types (Phase 1)
`browse`, `product_question`, `add_to_cart`, `view_cart`, `checkout`, `request_quote`, `order_status`, `my_account`, `talk_to_human`.

### Example: customer order with approval
> **Customer:** hi do you have cement 42.5? i need 30 bags delivered to Tlokweng
> **Morekisi:** Yes ✅ *Cement 42.5N 50kg*: P95.00/bag, in stock.
> 🛒 30 × Cement 42.5N = **P2,850.00**
> 🚚 Delivery to Tlokweng: the shop will confirm the delivery fee.
> [Place order] [Change] [Talk to a person]
> **Customer:** *Place order*
> **Morekisi:** Thank you! Order **ORD-00045** has been sent to Molefe Hardware. You'll get confirmation shortly.

*At the same time, the owner receives:*
> 🔔 *New order ORD-00045*: Tumelo (+267 71…), 30 × Cement 42.5N, P2,850.00, delivery to Tlokweng.
> [✅ Accept] [✏️ Edit] [❌ Reject]

*When the owner taps Accept (and adds a P150 delivery fee):*
> **Morekisi → Customer:** ✅ ORD-00045 confirmed: P3,000.00 incl. delivery. Pay on delivery or [Pay now]. 📎 ORD-00045.pdf

### WhatsApp platform constraints
- **The 24-hour customer service window:** replies within 24 hours of the customer's last message are free-form. Messages Morekisi sends first (evening summary, reminders, promotions) need **pre-approved templates**, which Meta charges for per message (marketing templates cost the most).
- **Templates to submit early:** `daily_summary`, `order_update`, `low_stock_alert`, `payment_reminder` (Phase 2), `new_order_alert`.
- **Connecting a number:** Morekisi registers as a **Meta Tech Provider** and uses **Embedded Signup**, so a shop connects its own number from the dashboard in a few minutes. Until that's approved, development and the pilot use test numbers we connect manually.
- A number connected to the Cloud API can't be used in the WhatsApp Business phone app at the same time (unless the shop uses *coexistence* onboarding). Shops must understand this before they connect.

---

## 6. Dashboard (web)

| Screen | Contents | Phase |
|---|---|---|
| Home | Sales, gross profit, orders waiting for approval, low stock, top debtors, cash-up differences | 1 |
| **Inbox** | WhatsApp conversations, bot/person handover, reply box, customer side panel | 1 |
| **Orders** | Approval queue, statuses, convert an order to a sale | 1 |
| Sales / Quotations | List, PDFs, voids | 1 |
| Products | CRUD, categories, CSV import, photos (for the catalogue), whether shown in the shop | 1 |
| Stock | Movement history, stock in, adjustments | 1 |
| Customers | Profile, timeline, tags, balance, statement | 1 |
| Cash-ups | Daily declared vs expected amounts | 1 |
| Reports | Sales, profit, debtor ageing, VAT | 1 |
| Settings | Shop details, VAT, WhatsApp connection, staff, opening hours, delivery areas and fees, approval rules | 1 |

Login uses Supabase Auth with a phone OTP.

---

## 7. Invoices and VAT

- `vat_rate_bp` defaults to 1400 (14%). `vat_registered = false` means no VAT is shown.
- Prices are VAT-inclusive by default: `vat = total × rate / (1 + rate)`. Cost prices are stored excluding VAT.
- PDFs are generated server-side (`@react-pdf/renderer`), stored in Supabase Storage and sent as WhatsApp documents.
- A **customer order is not a sale.** An order becomes a sale (invoice + stock out) when it's delivered or collected, or when it's paid in full. Before that, the stock is **reserved** but still on hand.

---

## 8. Data model

`supabase/migrations/0001_init.sql`: core ERP (businesses, users, products, stock ledger, customers, sales, quotations, payments, document counters, WhatsApp log, pending actions).
`supabase/migrations/0002_storefront_crm.sql`: shop WhatsApp accounts, conversations, carts, orders, product categories and images, customer tags, cash-ups, approval rules.

```
businesses ─┬─ wa_accounts (shop's own number)
            ├─ business_users
            ├─ categories ── products ── stock_movements ──► product_stock (on hand, reserved, available)
            ├─ customers ─┬─ conversations ── wa_messages
            │             ├─ carts ── cart_items
            │             ├─ orders ── order_items ──► (becomes) sales ── sale_items
            │             ├─ quotations ── quotation_items
            │             └─ payments ──► customer_balances
            ├─ cash_ups
            └─ doc_counters, pending_actions
```

---

## 9. The AI layer

- One module, `lib/ai/`, with `interpret(message, context) → Intent`. There are two tool sets: **back office** and **storefront**.
- The prompt includes the sender's role, recent turns of the conversation, and a **short list of candidate products and customers** from trigram search. It does not include the whole catalogue.
- Output is validated with Zod. If it's invalid or uncertain, the bot asks a clarifying question, or hands over to a person for customers.
- Storefront answers about price and stock are **built from database rows**. The LLM can only phrase them, never change the numbers.
- `ask` can only use read-only report functions. It never gets SQL access.
- Every interpretation is logged so we can measure accuracy and build a test set (English and Setswana, local abbreviations).

---

## 10. Project structure

```
morekisi/
  src/app/
    (dashboard)/...                 dashboard pages
    api/whatsapp/route.ts           webhook (GET verify, POST messages)
    api/cron/daily/route.ts         evening summaries
  src/lib/
    whatsapp/                       Cloud API client: text, buttons, lists, documents; signature check
    router.ts                       routes a message to back office or storefront
    office/                         back-office handlers
    store/                          storefront handlers
    ai/                             interpret(), tool schemas, prompts
    pdf/                            invoice, quote, order templates
    db/                             Supabase clients, typed RPC wrappers
    money.ts                        thebe ⇄ "P1,234.50"
  supabase/migrations/
  tests/
```

---

## 11. Build plan, Phase 1 (≈10 weeks)

| Week | Deliverable |
|---|---|
| 1 | Schema v2 + RLS · Next.js app skeleton · webhook with signature check · message routing · Cloud API client |
| 2 | Dashboard auth (phone OTP) · products, categories, CSV import · settings incl. WhatsApp connection |
| 3 | Back office: `check_stock`, `check_price`, `record_sale` + confirmation + invoice PDF |
| 4 | Back office: customers, credit, `record_payment`, `stock_in`, quotations |
| 5 | Storefront: welcome menu, catalogue browsing, cart, checkout → order |
| 6 | Order approval (WhatsApp + dashboard), order → sale, customer status updates |
| 7 | Inbox with bot/person handover · customer timeline and tags |
| 8 | Cash-up · evening summary template + cron · dashboard home and reports · `ask` |
| 9 | **Pilot with 2–3 hardware shops** |
| 10 | Fixes from the pilot, intent accuracy, onboarding |

**Phase 1 success metrics:**
- Pilot shops record **at least 80% of their sales** through Morekisi for 2 consecutive weeks.
- **At least 20 customer orders a week** per shop arrive through the storefront.
- Cash-up is completed on **at least 90% of trading days**.

---

## 12. Do now (not code)

1. **Meta Business verification** for the Morekisi company, then apply for **Tech Provider** status (needed for Embedded Signup).
2. Submit the WhatsApp **message templates** (section 5).
3. **Recruit 2–3 pilot shops**: collect their product lists (spreadsheet), real WhatsApp chats with customers (with consent) and how they do cash-up today.
4. Choose a **payment gateway** (needed in Phase 2). Check which offer merchant APIs and webhooks for Orange Money, MyZaka and Smega.
5. **Pricing hypothesis:** P299 / P599 / P999 per month by number of users, features and message allowance. Validate it with the pilots.
