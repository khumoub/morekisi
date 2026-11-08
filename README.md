# Morekisi

*Your Business. Your WhatsApp. One Platform.*

Morekisi is an AI-powered business platform for small businesses in Botswana. Owners and staff run the shop's daily operations (sales, invoices, stock, customer credit, reports) by sending WhatsApp messages, and the owner gets a full business dashboard.

The first target market is hardware shops and small wholesalers.

## Status

The MVP is being designed. See [`SPEC.md`](SPEC.md) for the full specification.

## Repository layout

| Path | Contents |
|---|---|
| `SPEC.md` | MVP specification: scope, WhatsApp message types, dashboard, data model, build plan |
| `supabase/migrations/` | Postgres schema, transactional write functions and Row Level Security policies |

## Stack

Next.js (Vercel) · Supabase / PostgreSQL · Meta WhatsApp Business Cloud API · LLM API
