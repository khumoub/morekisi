const modules = [
  { title: "WhatsApp shop", text: "Customers browse, ask for quotes and order on the shop's own WhatsApp number." },
  { title: "Customer book", text: "Every chat becomes a customer profile with orders, balances and history." },
  { title: "Back office", text: "Staff record sales, stock and payments by message. Invoices go out as PDFs." },
  { title: "Owner dashboard", text: "Sales, profit, debtors, stock and daily cash-up in one place." },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Morekisi</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">Your Business. Your WhatsApp. One Platform.</h1>
      <p className="mt-4 text-lg text-neutral-600">
        Morekisi turns your WhatsApp into your shop, your customer book and your back office.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {modules.map((m) => (
          <div key={m.title} className="rounded-xl border border-neutral-200 p-5">
            <h2 className="font-semibold">{m.title}</h2>
            <p className="mt-1 text-sm text-neutral-600">{m.text}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
