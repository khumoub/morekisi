import Papa from "papaparse";
import { parsePula } from "@/lib/money";

/**
 * Reads a product list exported from Excel, Google Sheets or a POS system.
 * Shops name their columns in many ways, so headers are matched by alias.
 * Output rows match the `import_products` database function (money in thebe).
 */

export interface ImportRow {
  line: number; // 1-based line in the file, header = 1
  sku: string;
  name: string;
  category: string;
  unit: string;
  sell_price: number;
  cost_price: number | null;
  reorder_level: number | null;
  stock: number | null;
}

export interface ImportIssue {
  line: number;
  message: string;
}

export interface ParsedImport {
  rows: ImportRow[];
  errors: ImportIssue[];
  /** Columns we recognised, e.g. { name: "Item Description", sell_price: "Retail" } */
  columns: Partial<Record<Column, string>>;
  ignoredColumns: string[];
}

type Column = "name" | "sku" | "category" | "unit" | "sell_price" | "cost_price" | "reorder_level" | "stock";

const ALIASES: Record<Column, string[]> = {
  name: ["name", "product", "product name", "item", "item name", "item description", "description", "product description"],
  sku: ["sku", "code", "item code", "product code", "barcode", "stock code", "part number"],
  category: ["category", "group", "department", "dept", "product group", "type"],
  unit: ["unit", "uom", "unit of measure", "units", "pack"],
  sell_price: ["price", "sell price", "selling price", "retail price", "retail", "sale price", "unit price", "price incl vat"],
  cost_price: ["cost", "cost price", "buying price", "purchase price", "unit cost", "cost excl vat"],
  reorder_level: ["reorder level", "reorder", "reorder point", "min stock", "minimum stock", "minimum", "min"],
  stock: ["stock", "qty", "quantity", "on hand", "stock on hand", "soh", "count", "qty on hand", "opening stock"],
};

export const TEMPLATE_CSV =
  "sku,name,category,unit,price,cost,reorder level,stock\n" +
  "CEM425,Cement 42.5N 50kg,Cement,bag,95.00,78.00,50,120\n" +
  "Y12,Rebar Y12 6m,Steel,each,120.00,90.00,20,40\n";

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function matchColumns(headers: string[]) {
  const columns: Partial<Record<Column, string>> = {};
  const ignored: string[] = [];
  for (const header of headers) {
    const h = norm(header);
    const col = (Object.keys(ALIASES) as Column[]).find((c) => !columns[c] && ALIASES[c].includes(h));
    if (col) columns[col] = header;
    else if (header.trim()) ignored.push(header);
  }
  // "description" is only the name when there is no better name column
  return { columns, ignored };
}

function parseQty(raw: string): number | null | "invalid" {
  const t = raw.trim().replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : "invalid";
}

export function parseProductCsv(text: string): ParsedImport {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const headers = parsed.meta.fields ?? [];
  const { columns, ignored } = matchColumns(headers);
  const errors: ImportIssue[] = [];

  if (!columns.name) errors.push({ line: 1, message: "No product name column found (e.g. \"name\" or \"product\")." });
  if (!columns.sell_price) errors.push({ line: 1, message: "No selling price column found (e.g. \"price\")." });
  if (errors.length) return { rows: [], errors, columns, ignoredColumns: ignored };

  const rows: ImportRow[] = [];
  const seenSku = new Map<string, number>();
  const seenName = new Map<string, number>();
  const get = (r: Record<string, string>, c: Column) => (columns[c] ? String(r[columns[c]!] ?? "").trim() : "");

  parsed.data.forEach((r, i) => {
    const line = i + 2;
    const name = get(r, "name");
    const sku = get(r, "sku");
    if (!name) {
      errors.push({ line, message: "Missing product name." });
      return;
    }

    const price = parsePula(get(r, "sell_price"));
    if (price === null) {
      errors.push({ line, message: `"${name}": selling price "${get(r, "sell_price")}" is not a valid amount.` });
      return;
    }

    const costRaw = get(r, "cost_price");
    const cost = costRaw ? parsePula(costRaw) : null;
    if (costRaw && cost === null) {
      errors.push({ line, message: `"${name}": cost "${costRaw}" is not a valid amount.` });
      return;
    }

    const reorder = parseQty(get(r, "reorder_level"));
    const stock = parseQty(get(r, "stock"));
    if (reorder === "invalid" || stock === "invalid") {
      errors.push({ line, message: `"${name}": reorder level and stock must be numbers.` });
      return;
    }
    if (stock !== null && stock < 0) {
      errors.push({ line, message: `"${name}": stock can't be negative.` });
      return;
    }

    if (sku) {
      if (seenSku.has(sku.toLowerCase())) {
        errors.push({ line, message: `Code "${sku}" also appears on line ${seenSku.get(sku.toLowerCase())}.` });
        return;
      }
      seenSku.set(sku.toLowerCase(), line);
    } else {
      if (seenName.has(name.toLowerCase())) {
        errors.push({ line, message: `"${name}" also appears on line ${seenName.get(name.toLowerCase())}.` });
        return;
      }
      seenName.set(name.toLowerCase(), line);
    }

    rows.push({
      line,
      sku,
      name,
      category: get(r, "category"),
      unit: get(r, "unit").toLowerCase() || "each",
      sell_price: price,
      cost_price: cost,
      reorder_level: reorder,
      stock,
    });
  });

  for (const e of parsed.errors) {
    if (e.type !== "FieldMismatch") errors.push({ line: (e.row ?? 0) + 2, message: e.message });
  }
  return { rows, errors, columns, ignoredColumns: ignored };
}

/** Rows in the shape `import_products` expects (drops nulls so the database keeps existing values). */
export function toImportPayload(rows: ImportRow[]) {
  return rows.map((r) => {
    const out: Record<string, string | number> = {
      sku: r.sku,
      name: r.name,
      category: r.category,
      unit: r.unit,
      sell_price: r.sell_price,
    };
    if (r.cost_price !== null) out.cost_price = r.cost_price;
    if (r.reorder_level !== null) out.reorder_level = r.reorder_level;
    if (r.stock !== null) out.stock = r.stock;
    return out;
  });
}
