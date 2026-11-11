import { describe, expect, it } from "vitest";
import { parseProductCsv, TEMPLATE_CSV, toImportPayload } from "@/lib/csv/products";

describe("product CSV import", () => {
  it("reads the template", () => {
    const r = parseProductCsv(TEMPLATE_CSV);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      sku: "CEM425",
      name: "Cement 42.5N 50kg",
      category: "Cement",
      unit: "bag",
      sell_price: 9500,
      cost_price: 7800,
      reorder_level: 50,
      stock: 120,
    });
  });

  it("understands other column names, an Excel BOM, P prefixes and thousands separators", () => {
    const csv =
      "﻿Item Code;Item Description;Retail;Buying Price;SOH;Supplier\n" +
      'B1;Bricks (cement) 140mm;P 6.50;P4.80;"1,200";Brickworks\n';
    const r = parseProductCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.columns).toMatchObject({ sku: "Item Code", name: "Item Description", sell_price: "Retail", stock: "SOH" });
    expect(r.ignoredColumns).toEqual(["Supplier"]);
    expect(r.rows[0]).toMatchObject({ sell_price: 650, cost_price: 480, stock: 1200, unit: "" });
  });

  it("reports missing required columns", () => {
    const r = parseProductCsv("code,qty\nA,1\n");
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => e.message).join(" ")).toMatch(/name column.*price column/);
  });

  it("reports bad rows with line numbers and keeps the good ones", () => {
    const csv = [
      "name,price,stock,sku",
      "Cement,95,10,C1",
      ",50,1,",
      "Paint 5L,abc,1,",
      "Nails,35,-3,",
      "Cement again,95,1,C1",
      "Sand,250,,",
      "sand,250,,",
    ].join("\n");
    const r = parseProductCsv(csv);
    expect(r.rows.map((x) => x.name)).toEqual(["Cement", "Sand"]);
    expect(r.errors).toEqual([
      { line: 3, message: "Missing product name." },
      { line: 4, message: '"Paint 5L": selling price "abc" is not a valid amount.' },
      { line: 5, message: '"Nails": stock can\'t be negative.' },
      { line: 6, message: 'Code "C1" also appears on line 2.' },
      { line: 8, message: '"sand" also appears on line 7.' },
    ]);
  });

  it("leaves out empty optional values so the database keeps what it has", () => {
    const [row] = toImportPayload(parseProductCsv("name,price\nSand,250\n").rows);
    expect(row).toEqual({ sku: "", name: "Sand", category: "", sell_price: 25000 });
  });
});
