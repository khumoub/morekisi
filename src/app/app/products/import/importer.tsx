"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { parseProductCsv, TEMPLATE_CSV, type ParsedImport } from "@/lib/csv/products";
import { formatPula } from "@/lib/money";
import { Button, buttonClass, Card, Notice } from "@/components/ui";
import { importProducts } from "../actions";

const COLUMN_LABEL: Record<string, string> = {
  name: "Name",
  sku: "Code",
  category: "Category",
  unit: "Unit",
  sell_price: "Price",
  cost_price: "Cost",
  reorder_level: "Reorder level",
  stock: "Stock",
};

export function Importer() {
  const [file, setFile] = useState<string | null>(null);
  const [result, setResult] = useState<ParsedImport | null>(null);
  const [done, setDone] = useState<{ created: number; updated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setDone(null);
    setError(null);
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) {
      setResult(null);
      setError("Please choose a .csv file. In Excel: File → Save As → CSV (Comma delimited).");
      return;
    }
    setFile(f.name);
    setResult(parseProductCsv(await f.text()));
  }

  function submit() {
    if (!result) return;
    startTransition(async () => {
      const res = await importProducts(result.rows);
      if (res.error) setError(res.error);
      else {
        setDone({ created: res.created ?? 0, updated: res.updated ?? 0 });
        setResult(null);
        setFile(null);
      }
    });
  }

  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`;

  return (
    <div className="space-y-6">
      <Card>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-600 dark:text-neutral-400">
          <li>
            Export your product list from Excel, Google Sheets or your till as <strong>CSV</strong>, or start from{" "}
            <a href={template} download="morekisi-products.csv" className="font-medium text-emerald-700 underline">
              our template
            </a>
            .
          </li>
          <li>You need at least a <strong>name</strong> and a <strong>price</strong> column. Code, category, unit, cost, reorder level and stock are optional.</li>
          <li>
            Importing again updates existing products (matched by code, or by name) and sets stock to the numbers in the file,
            which is handy after a stock take.
          </li>
        </ol>
        <input
          type="file"
          accept=".csv,text/csv,.txt"
          onChange={onFile}
          className="mt-4 block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-700 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
        />
      </Card>

      {error && <Notice tone="error">{error}</Notice>}
      {done && (
        <Notice tone="success">
          Imported: {done.created} new product{done.created === 1 ? "" : "s"}, {done.updated} updated.{" "}
          <Link href="/app/products" className="font-medium underline">
            View products
          </Link>
        </Notice>
      )}

      {result && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">{file}</h2>
              <p className="text-sm text-neutral-500">
                {result.rows.length} product{result.rows.length === 1 ? "" : "s"} ready
                {result.errors.length > 0 && `, ${result.errors.length} problem${result.errors.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <Button onClick={submit} disabled={pending || result.rows.length === 0}>
              {pending ? "Importing…" : `Import ${result.rows.length} products`}
            </Button>
          </div>

          <p className="mt-3 text-xs text-neutral-500">
            Columns found:{" "}
            {Object.entries(result.columns)
              .map(([k, v]) => `${COLUMN_LABEL[k]} ← "${v}"`)
              .join(" · ")}
            {result.ignoredColumns.length > 0 && <> · ignored: {result.ignoredColumns.join(", ")}</>}
          </p>

          {result.errors.length > 0 && (
            <div className="mt-4">
              <Notice tone="error">
                <p className="font-medium">These lines will be skipped. Fix them in your file and import again:</p>
                <ul className="mt-1 list-disc pl-5">
                  {result.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>
                      Line {e.line}: {e.message}
                    </li>
                  ))}
                  {result.errors.length > 20 && <li>…and {result.errors.length - 20} more</li>}
                </ul>
              </Notice>
            </div>
          )}

          {result.rows.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Code</th>
                    <th className="py-2 pr-3 font-medium">Category</th>
                    <th className="py-2 pr-3 text-right font-medium">Price</th>
                    <th className="py-2 pr-3 text-right font-medium">Cost</th>
                    <th className="py-2 text-right font-medium">Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {result.rows.slice(0, 50).map((r) => (
                    <tr key={r.line}>
                      <td className="py-2 pr-3">{r.name}</td>
                      <td className="py-2 pr-3 text-neutral-500">{r.sku || "—"}</td>
                      <td className="py-2 pr-3 text-neutral-500">{r.category || "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatPula(r.sell_price)}/{r.unit}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-neutral-500">
                        {r.cost_price === null ? "—" : formatPula(r.cost_price)}
                      </td>
                      <td className="py-2 text-right tabular-nums">{r.stock ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length > 50 && (
                <p className="mt-2 text-xs text-neutral-500">Showing the first 50 of {result.rows.length}.</p>
              )}
            </div>
          )}
        </Card>
      )}

      <Link href="/app/products" className={buttonClass("secondary")}>
        Back to products
      </Link>
    </div>
  );
}
