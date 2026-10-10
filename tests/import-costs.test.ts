import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { products, unitGroups, units } from "@/db/schema";
import { detectMapping, parseCsv, parseRows } from "@/import/collectr";
import { applyImport, planImport } from "@/server/import";
import { testDb } from "./db";

const HEADER = "Portfolio Name,Category,Set,Product Name,Card Number,Rarity,Variance,Grade,Card Condition,Average Cost Paid,Quantity,Market Price (As of 2026-10-08),Price Override,Watchlist,Date Added,Notes";
const parse = (text: string) => {
  const { headers, rows } = parseCsv(text);
  return parseRows(rows, detectMapping(headers)).items;
};
const file = parse(
  [
    HEADER,
    "Main,Pokemon,Obsidian Flames,Charizard ex,223/197,SIR,Holofoil,Ungraded,Lightly Played,60.0000,2,71.20,0,false,2026-05-02,",
    "Main,Pokemon,Evolving Skies,Umbreon VMAX,215/203,SR,Holofoil,Ungraded,Near Mint,900.0000,1,1412.37,0,false,2026-05-01,",
    "Vendor,Pokemon,Evolving Skies,Umbreon VMAX,215/203,SR,Holofoil,Ungraded,Near Mint,0.0000,1,1412.37,0,false,2026-10-01,",
    "Vendor,Pokemon,Obsidian Flames,Charizard ex,223/197,SIR,Holofoil,Ungraded,Near Mint,0.0000,1,80.00,0,false,2026-10-01,",
    "Vendor,Pokemon,151,Mew ex,151/165,DR,Holofoil,Ungraded,Near Mint,0.0000,1,30.00,0,false,2026-10-01,",
  ].join("\n"),
);
const vendor = file.filter((r) => r.portfolio === "Vendor");
const main = file.filter((r) => r.portfolio === "Main");

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(async () => close());

const vendorCosts = async () => {
  const [g] = await db.select().from(unitGroups).where(eq(unitGroups.name, "Vendor"));
  const rows = await db.select({ name: products.name, cost: units.costCents }).from(units).innerJoin(products, eq(products.id, units.productId)).where(eq(units.groupId, g!.id));
  return Object.fromEntries(rows.map((r) => [r.name, r.cost]));
};

describe("costs from my other portfolios", () => {
  it("fills copies already imported with no cost, once", async () => {
    // imported before this feature: the display portfolio alone, no costs
    await applyImport(db, vendor, "vendor.csv");
    expect(await vendorCosts()).toEqual({ "Umbreon VMAX": null, "Charizard ex": null, "Mew ex": null });

    const plan = await planImport(db, vendor, { kind: "own" }, { costDonors: main });
    expect(plan).toMatchObject({ newUnits: 0, costsMatched: 2 });
    const res = await applyImport(db, vendor, "vendor.csv", { kind: "own" }, { costDonors: main });
    expect(res.costsMatched).toBe(2);
    // Charizard was scanned as NM but is LP in Main: same card, cost carried over; Mew has no cost anywhere
    expect(await vendorCosts()).toEqual({ "Umbreon VMAX": 90000, "Charizard ex": 6000, "Mew ex": null });

    expect((await planImport(db, vendor, { kind: "own" }, { costDonors: main })).costsMatched).toBe(0);
    // the portfolio left out is not imported
    expect(await db.select().from(unitGroups).where(eq(unitGroups.name, "Main"))).toHaveLength(0);
  });

  it("fills new copies as they are imported", async () => {
    const extra = parse(
      [HEADER, "Vendor,Pokemon,Obsidian Flames,Charizard ex,223/197,SIR,Holofoil,Ungraded,Near Mint,0.0000,2,80.00,0,false,2026-10-01,"].join("\n"),
    );
    // a second display copy: Main has two, one already lent
    const res = await applyImport(db, extra, "vendor2.csv", { kind: "own" }, { costDonors: main });
    expect(res).toMatchObject({ newUnits: 1, costsMatched: 1 });
    const charizards = await db
      .select({ cost: units.costCents })
      .from(units)
      .innerJoin(products, eq(products.id, units.productId))
      .where(eq(products.name, "Charizard ex"));
    expect(charizards.map((c) => c.cost)).toEqual([6000, 6000]);
  });
});

describe("a collection bought as a lot", () => {
  const sample = parse(readFileSync(path.join(__dirname, "../fixtures/collectr/sample.csv"), "utf8"));

  it("costs every new copy at the percentage of market, in place of the seller's costs", async () => {
    const { db, close } = await testDb();
    try {
      const plan = await planImport(db, sample, { kind: "own" }, { lotPercent: 70 });
      const expected = plan.rows.reduce((n, r) => n + r.newUnits * (r.newMarketCents === null ? 0 : Math.round((r.newMarketCents * 70) / 100)), 0);
      expect(plan.lotCostCents).toBe(expected);
      await applyImport(db, sample, "lot.csv", { kind: "own" }, { lotPercent: 70 });
      const rows = await db.select({ cost: units.costCents, market: products.marketCents, name: products.name }).from(units).innerJoin(products, eq(products.id, units.productId));
      for (const r of rows) expect(r.cost).toBe(r.market === null ? null : Math.round((r.market * 70) / 100));
      // Umbreon: the seller paid $900, I paid 70% of $1,412.37
      expect(rows.find((r) => r.name.startsWith("Umbreon"))!.cost).toBe(98866);
    } finally {
      await close();
    }
  });

  it("does not apply to a consignor's cards", async () => {
    const { db, close } = await testDb();
    try {
      const [g] = await db.insert(unitGroups).values({ name: "Alex", kind: "consignment", feeBps: 1500, minFeeCents: 0 }).returning();
      const plan = await planImport(db, sample, { kind: "consignment", groupId: g!.id }, { lotPercent: 70 });
      expect(plan.lotCostCents).toBeNull();
    } finally {
      await close();
    }
  });
});
