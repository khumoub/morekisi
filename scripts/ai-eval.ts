/**
 * Measures how well the configured AI understands real shop messages.
 * Calls the real model (costs money: ~45 short requests), so it's run by hand, not in CI:
 *
 *   AI_PROVIDER=claude ANTHROPIC_API_KEY=... npm run eval:ai
 *   AI_PROVIDER=openai OPENAI_API_KEY=... AI_MODEL=... npm run eval:ai
 *
 * Each case checks only the fields that matter for it. Add real messages from pilot shops here
 * (with the owner's consent) — this set is how we know a prompt or model change helped.
 */
import { getProvider } from "../src/lib/ai";
import { interpret } from "../src/lib/ai/interpret";
import type { Interpretation } from "../src/lib/ai/intent";

const catalogue = [
  { name: "Cement 42.5N 50kg", unit: "bag" },
  { name: "Cement 32.5N 50kg", unit: "bag" },
  { name: "Rebar Y12 6m", unit: "each" },
  { name: "Rebar Y10 6m", unit: "each" },
  { name: "IBR Roof Sheet 0.47mm 6m", unit: "sheet" },
  { name: "River Sand", unit: "cube" },
  { name: "Bricks Cement 140mm", unit: "each" },
  { name: "PVC Pipe 110mm 6m", unit: "each" },
  { name: "Plascon Wall Paint White 20L", unit: "tin" },
  { name: "Nails 75mm 1kg", unit: "kg" },
];

type Expect = Partial<Pick<Interpretation, "intent" | "customer" | "payment_method" | "amount" | "supplier" | "period" | "quote_no">> & {
  items?: { product: string | RegExp; qty?: number | null; unit_price?: number | null }[];
  language?: "en" | "tn";
};

interface Case {
  message: string;
  expect: Expect;
  history?: { from: "staff" | "morekisi"; text: string }[];
  pending?: string;
}

const cases: Case[] = [
  // Sales — English, shorthand, typos
  { message: "sold 20 cement 42.5 and 5 rebar 12 to kabelo on credit", expect: { intent: "record_sale", customer: "kabelo", payment_method: "credit", items: [{ product: "Cement 42.5N 50kg", qty: 20 }, { product: "Rebar Y12 6m", qty: 5 }] } },
  { message: "20 bags cem 42.5 cash", expect: { intent: "record_sale", payment_method: "cash", items: [{ product: "Cement 42.5N 50kg", qty: 20 }] } },
  { message: "Tlotlo took 3 cubes river sand, he'll pay month end", expect: { intent: "record_sale", customer: "Tlotlo", payment_method: "credit", items: [{ product: "River Sand", qty: 3 }] } },
  { message: "sold 10 ibr sheets swipe", expect: { intent: "record_sale", payment_method: "card", items: [{ product: "IBR Roof Sheet 0.47mm 6m", qty: 10 }] } },
  { message: "cement x50 to Mpho OM", expect: { intent: "record_sale", customer: "Mpho", payment_method: "orange_money", items: [{ product: /cement/i, qty: 50 }] } },
  { message: "sold twenty pvc pipes 110", expect: { intent: "record_sale", items: [{ product: "PVC Pipe 110mm 6m", qty: 20 }] } },
  { message: "1.5k worth of bricks? no wait - sold 300 bricks at 6 each", expect: { intent: "record_sale", items: [{ product: "Bricks Cement 140mm", qty: 300, unit_price: 6 }] } },
  { message: "invoice Kgosi 2 tins white paint, myzaka", expect: { intent: "record_sale", customer: "Kgosi", payment_method: "myzaka", items: [{ product: "Plascon Wall Paint White 20L", qty: 2 }] } },
  { message: "sold 5 cement", expect: { intent: "record_sale", items: [{ product: /cement/i, qty: 5 }] } },
  { message: "sld 4 y10 bars eft", expect: { intent: "record_sale", payment_method: "eft", items: [{ product: "Rebar Y10 6m", qty: 4 }] } },
  // Sales — Setswana / mixed
  { message: "ke rekisitse cement di le 10 go Kabelo, o tla duela", expect: { intent: "record_sale", customer: "Kabelo", payment_method: "credit", items: [{ product: /cement/i, qty: 10 }], language: "tn" } },
  { message: "Mma Sebina o rekile bricks di le 500 ka cash", expect: { intent: "record_sale", payment_method: "cash", items: [{ product: "Bricks Cement 140mm", qty: 500 }] } },
  { message: "re rekisitse sand cubes tse pedi", expect: { intent: "record_sale", items: [{ product: "River Sand", qty: 2 }] } },

  // Payments
  { message: "Kabelo paid P500 orange money", expect: { intent: "record_payment", customer: "Kabelo", amount: 500, payment_method: "orange_money" } },
  { message: "tlotlo settled 1.2k by transfer", expect: { intent: "record_payment", customer: "tlotlo", amount: 1200, payment_method: "eft" } },
  { message: "Kgosi o duetse 300 cash", expect: { intent: "record_payment", customer: "Kgosi", amount: 300, payment_method: "cash" } },
  { message: "received payment from Mpho 250 smega", expect: { intent: "record_payment", customer: "Mpho", amount: 250, payment_method: "smega" } },

  // Stock in
  { message: "received 200 cement 42.5 from Builders Depot at P78", expect: { intent: "stock_in", supplier: "Builders Depot", items: [{ product: "Cement 42.5N 50kg", qty: 200, unit_price: 78 }] } },
  { message: "stock in 50 IBR sheets", expect: { intent: "stock_in", items: [{ product: "IBR Roof Sheet 0.47mm 6m", qty: 50 }] } },
  { message: "delivery from Cashbuild: 100 y12, 100 y10", expect: { intent: "stock_in", supplier: "Cashbuild", items: [{ product: "Rebar Y12 6m", qty: 100 }, { product: "Rebar Y10 6m", qty: 100 }] } },
  { message: "re amogetse nails 20kg", expect: { intent: "stock_in", items: [{ product: "Nails 75mm 1kg", qty: 20 }] } },

  // Questions
  { message: "how much cement do we have", expect: { intent: "check_stock", items: [{ product: /cement/i }] } },
  { message: "do we still have 12mm bars?", expect: { intent: "check_stock", items: [{ product: "Rebar Y12 6m" }] } },
  { message: "re na le sand e kae?", expect: { intent: "check_stock", items: [{ product: "River Sand" }] } },
  { message: "price of ibr", expect: { intent: "check_price", items: [{ product: "IBR Roof Sheet 0.47mm 6m" }] } },
  { message: "how much are we selling paint for", expect: { intent: "check_price", items: [{ product: /paint/i }] } },
  { message: "who owes us money?", expect: { intent: "customer_balance", customer: null } },
  { message: "kabelo's balance", expect: { intent: "customer_balance", customer: "kabelo" } },
  { message: "sales today", expect: { intent: "report", period: "today" } },
  { message: "how did we do last week", expect: { intent: "report", period: "last_week" } },
  { message: "profit this month?", expect: { intent: "report", period: "this_month" } },
  { message: "which product sells the most this month", expect: { intent: "ask" } },
  { message: "should I order more cement?", expect: { intent: "ask" } },
  { message: "quote Tlotlo 100 bricks and 10 cement", expect: { intent: "create_quote", customer: "Tlotlo", items: [{ product: "Bricks Cement 140mm", qty: 100 }, { product: /cement/i, qty: 10 }] } },
  { message: "make a quotation for Mpho: 20 ibr sheets", expect: { intent: "create_quote", customer: "Mpho", items: [{ product: "IBR Roof Sheet 0.47mm 6m", qty: 20 }] } },
  { message: "QT-00012 accepted, cash", expect: { intent: "accept_quote", quote_no: "00012", payment_method: "cash" } },
  { message: "Tlotlo accepted quote 15 on account", expect: { intent: "accept_quote", quote_no: "15", payment_method: "credit" } },

  // Conversation
  { message: "hi", expect: { intent: "help" } },
  { message: "dumela", expect: { intent: "help" } },
  { message: "what can you do", expect: { intent: "help" } },
  { message: "yes", pending: "Sale — Kabelo: 20 × Cement 42.5N, total P1,900", expect: { intent: "confirm" } },
  { message: "ee", pending: "Sale — Kabelo: 20 × Cement 42.5N, total P1,900", expect: { intent: "confirm" } },
  { message: "no leave it", pending: "Sale — Kabelo: 20 × Cement 42.5N, total P1,900", expect: { intent: "cancel" } },
  {
    message: "make it 25",
    history: [
      { from: "staff", text: "sold 20 cement 42.5 to kabelo credit" },
      { from: "morekisi", text: "🧾 Sale — Kabelo Molefe: 20 × Cement 42.5N 50kg @ P95.00 … Confirm?" },
    ],
    pending: "Sale — Kabelo Molefe: 20 × Cement 42.5N 50kg, credit",
    expect: { intent: "record_sale", customer: "Kabelo Molefe", payment_method: "credit", items: [{ product: "Cement 42.5N 50kg", qty: 25 }] },
  },
  { message: "kabelo 20", expect: { intent: "unclear" } },
];

function same(a: unknown, b: unknown) {
  if (typeof a === "string" && typeof b === "string") return a.trim().toLowerCase().includes(b.trim().toLowerCase()) || b.trim().toLowerCase().includes(a.trim().toLowerCase());
  return a === b;
}

function check(got: Interpretation, exp: Expect): string[] {
  const problems: string[] = [];
  for (const key of ["intent", "customer", "payment_method", "amount", "supplier", "period", "quote_no", "language"] as const) {
    if (key in exp && !same(got[key], exp[key])) problems.push(`${key}: expected ${JSON.stringify(exp[key])}, got ${JSON.stringify(got[key])}`);
  }
  if (exp.items) {
    if (got.items.length !== exp.items.length) problems.push(`items: expected ${exp.items.length}, got ${got.items.length} (${JSON.stringify(got.items)})`);
    exp.items.forEach((e, i) => {
      const g = got.items[i];
      if (!g) return;
      const ok = e.product instanceof RegExp ? e.product.test(g.product) : g.product.toLowerCase() === e.product.toLowerCase();
      if (!ok) problems.push(`item ${i + 1} product: expected ${e.product}, got "${g.product}"`);
      if (e.qty !== undefined && g.qty !== e.qty) problems.push(`item ${i + 1} qty: expected ${e.qty}, got ${g.qty}`);
      if (e.unit_price !== undefined && g.unit_price !== e.unit_price) problems.push(`item ${i + 1} price: expected ${e.unit_price}, got ${g.unit_price}`);
    });
  }
  return problems;
}

async function main() {
  const provider = getProvider();
  if (!provider) {
    console.error("No AI configured. Set AI_PROVIDER and the provider's API key (see .env.example).");
    process.exit(1);
  }
  console.log(`Evaluating ${cases.length} messages with ${provider.name}…\n`);
  let passed = 0;
  const failures: string[] = [];
  const start = Date.now();
  for (const c of cases) {
    try {
      const got = await interpret(provider, { shopName: "Molefe Hardware", catalogue, history: c.history ?? [], pending: c.pending ?? null, message: c.message });
      const problems = check(got, c.expect);
      if (problems.length === 0) {
        passed++;
        process.stdout.write("✓");
      } else {
        process.stdout.write("✗");
        failures.push(`"${c.message}"\n   ${problems.join("\n   ")}`);
      }
    } catch (err) {
      process.stdout.write("E");
      failures.push(`"${c.message}"\n   error: ${(err as Error).message}`);
    }
  }
  const secs = ((Date.now() - start) / 1000 / cases.length).toFixed(1);
  console.log(`\n\n${passed}/${cases.length} correct (${Math.round((passed / cases.length) * 100)}%) · ~${secs}s per message\n`);
  if (failures.length) console.log(`Needs attention:\n\n${failures.join("\n\n")}`);
  process.exit(passed / cases.length >= 0.9 ? 0 : 1);
}

main();
