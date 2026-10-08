import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  badgeFor,
  detailFor,
  detectMapping,
  normHeader,
  parseCsv,
  parseRows,
  productKind,
  shortCondition,
  splitGrade,
} from "./collectr";

const sample = readFileSync(path.join(__dirname, "../../fixtures/collectr/sample.csv"), "utf8");

describe("detectMapping", () => {
  it("finds the Collectr-style columns by name", () => {
    const { headers } = parseCsv(sample);
    const m = detectMapping(headers);
    const col = (i: number | null) => (i === null ? null : headers[i]);
    expect(col(m.name)).toBe("Product Name");
    expect(col(m.set)).toBe("Set");
    expect(col(m.number)).toBe("Card Number");
    expect(col(m.quantity)).toBe("Quantity");
    expect(col(m.market)).toBe("Market Price");
    expect(col(m.cost)).toBe("Average Cost Paid");
    expect(col(m.condition)).toBe("Card Condition");
    expect(col(m.grade)).toBe("Grade");
    expect(col(m.variant)).toBe("Variance");
    expect(col(m.portfolio)).toBe("Portfolio Name");
    expect(col(m.category)).toBe("Category");
    expect(m.cert).toBeNull();
  });

  it("never reads a cost column as the market price", () => {
    const m = detectMapping(["Name", "Price Paid", "Market Value"]);
    expect(m.market).toBeNull();
    expect(m.cost).toBe(1);
    expect(m.marketTotal).toBe(2);
  });

  it("strips a byte-order mark from the first header", () => {
    expect(normHeader(String.fromCharCode(0xfeff) + "Product Name")).toBe("product name");
  });
});

describe("parseCsv", () => {
  it("skips preamble lines above the header", () => {
    const { headers, rows } = parseCsv("My export\n\nName,Qty\nPikachu,2\n");
    expect(headers).toEqual(["Name", "Qty"]);
    expect(rows).toEqual([["Pikachu", "2"]]);
  });
});

describe("parseRows", () => {
  const { headers, rows } = parseCsv(sample);
  const { items, skipped } = parseRows(rows, detectMapping(headers));
  const byName = (n: string) => items.find((i) => i.name === n);

  it("reads raw cards with condition, cost, and market price", () => {
    const u = byName("Umbreon VMAX (Alternate Full Art)");
    expect(u).toMatchObject({
      kind: "raw",
      setName: "Evolving Skies",
      cardNumber: "215/203",
      condition: "NM",
      quantity: 1,
      marketCents: 141237,
      costCents: 90000,
      portfolio: "Show Stock",
    });
    expect(byName("Charizard ex")).toMatchObject({ condition: "LP", quantity: 2, marketCents: 7120 });
  });

  it("reads a grade written as one 'PSA 10' value as a slab", () => {
    expect(byName("Pikachu")).toMatchObject({ kind: "slab", grader: "PSA", grade: "10", condition: "" });
  });

  it("recognizes sealed product and keeps accents in names", () => {
    expect(byName("Paldean Fates Booster Bundle")).toMatchObject({ kind: "sealed", quantity: 3 });
    expect(byName("Flabébé")).toMatchObject({ kind: "raw", costCents: null, marketCents: 12 });
  });

  it("keeps the portfolio so the import page can leave a personal collection out", () => {
    expect(byName("Charizard")?.portfolio).toBe("Personal");
  });

  it("skips nameless rows and zero quantities with a reason", () => {
    expect(skipped).toEqual([
      { line: 7, reason: "no name", name: "" },
      { line: 8, reason: 'quantity "0"', name: "Giratina V (Alternate Full Art)" },
    ]);
    expect(items).toHaveLength(6);
  });

  it("gives the same card the same key, and different conditions different keys", () => {
    const again = parseRows(rows, detectMapping(headers)).items;
    expect(again.map((i) => i.key)).toEqual(items.map((i) => i.key));
    const keys = new Set(items.map((i) => i.key));
    expect(keys.size).toBe(items.length);
  });

  it("divides a total market value by quantity when there is no per-card price", () => {
    const { items: t } = parseRows([["Pikachu", "3", "$30.00"]], detectMapping(["Name", "Quantity", "Total Value"]));
    expect(t[0]?.marketCents).toBe(1000);
  });

  it("keys a slab by its cert", () => {
    const m = detectMapping(["Name", "Grader", "Grade", "Cert Number"]);
    const { items: s } = parseRows([["Pikachu", "PSA", "10", "12345678"]], m);
    expect(s[0]?.key).toBe("cert:psa:12345678");
  });
});

describe("helpers", () => {
  it("splitGrade", () => {
    expect(splitGrade("", "PSA 10")).toEqual({ grader: "PSA", grade: "10" });
    expect(splitGrade("", "cgc 9.5")).toEqual({ grader: "CGC", grade: "9.5" });
    expect(splitGrade("bgs", "9.5")).toEqual({ grader: "BGS", grade: "9.5" });
    expect(splitGrade("", "10")).toEqual({ grader: "", grade: "10" });
  });

  it("shortCondition", () => {
    expect(shortCondition("Near Mint")).toBe("NM");
    expect(shortCondition("Moderately Played")).toBe("MP");
    expect(shortCondition("Weird")).toBe("Weird");
  });

  it("productKind does not call a numbered card sealed", () => {
    expect(productKind({ grader: "", grade: "", cardNumber: "12/100", name: "Energy Pack", category: "" })).toBe("raw");
    expect(productKind({ grader: "", grade: "", cardNumber: "", name: "Elite Trainer Box", category: "" })).toBe("sealed");
  });

  it("badge and detail lines", () => {
    expect(badgeFor({ kind: "slab", condition: "", grader: "PSA", grade: "10" })).toBe("PSA 10");
    expect(badgeFor({ kind: "sealed", condition: "", grader: "", grade: "" })).toBe("Sealed");
    expect(badgeFor({ kind: "raw", condition: "NM", grader: "", grade: "" })).toBe("NM");
    expect(detailFor({ setName: "Evolving Skies", cardNumber: "215/203", variant: "" })).toBe("Evolving Skies #215/203");
    expect(detailFor({ setName: "Paldean Fates", cardNumber: "", variant: "" })).toBe("Paldean Fates");
  });
});
