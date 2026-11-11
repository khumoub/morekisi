import { z } from "zod";

/**
 * What the AI returns for a back-office message. It only *extracts* — product and customer
 * names are resolved against the database afterwards, and all prices/totals come from there.
 *
 * The JSON schema below is written by hand (not generated) so it works with both providers'
 * strict structured-output modes: every property required, optional values as `anyOf [T, null]`,
 * `additionalProperties: false` everywhere, no numeric/string constraints.
 */

export const INTENTS = [
  "record_sale", // "sold 20 cement to Kabelo on credit"
  "record_payment", // "Kabelo paid P500 Orange Money"
  "stock_in", // "received 200 cement from Builders Depot at P78"
  "create_quote", // "quote Tlotlo 100 bricks"
  "accept_quote", // "QT-00012 accepted, cash" — turn a quotation into a sale
  "check_stock", // "how much rebar do we have"
  "check_price", // "price of 6m IBR sheet"
  "customer_balance", // "who owes us", "Kabelo balance"
  "report", // "sales today", "profit this week"
  "ask", // any other question about the business
  "confirm", // "yes", "ok", "ee" — answering a pending confirmation
  "cancel", // "no", "cancel", "nnyaa"
  "help", // greetings, "what can you do"
  "unclear", // can't tell — `reply` holds a clarifying question
] as const;

export const PAYMENT_METHODS = ["cash", "card", "orange_money", "myzaka", "smega", "eft", "credit"] as const;
export const PERIODS = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month"] as const;

export const lineSchema = z.object({
  product: z.string(), // exact catalogue name if confident, else the words used
  qty: z.number().nullable(),
  unit_price: z.number().nullable(), // Pula, only if the person said a price
});

export const interpretationSchema = z.object({
  intent: z.enum(INTENTS),
  items: z.array(lineSchema),
  customer: z.string().nullable(),
  payment_method: z.enum(PAYMENT_METHODS).nullable(),
  amount: z.number().nullable(), // Pula, for payments
  supplier: z.string().nullable(),
  period: z.enum(PERIODS).nullable(),
  quote_no: z.string().nullable(), // for accept_quote: "QT-00012"
  question: z.string().nullable(), // for "ask": the question restated clearly
  reply: z.string().nullable(), // for "unclear"/"help": what to say back
  language: z.enum(["en", "tn"]), // reply in English or Setswana
});

export type Interpretation = z.infer<typeof interpretationSchema>;
export type Intent = Interpretation["intent"];

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

export const interpretationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "items", "customer", "payment_method", "amount", "supplier", "period", "quote_no", "question", "reply", "language"],
  properties: {
    intent: { type: "string", enum: [...INTENTS] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["product", "qty", "unit_price"],
        properties: {
          product: { type: "string" },
          qty: nullable({ type: "number" }),
          unit_price: nullable({ type: "number" }),
        },
      },
    },
    customer: nullable({ type: "string" }),
    payment_method: nullable({ type: "string", enum: [...PAYMENT_METHODS] }),
    amount: nullable({ type: "number" }),
    supplier: nullable({ type: "string" }),
    period: nullable({ type: "string", enum: [...PERIODS] }),
    quote_no: nullable({ type: "string" }),
    question: nullable({ type: "string" }),
    reply: nullable({ type: "string" }),
    language: { type: "string", enum: ["en", "tn"] },
  },
} as const;
