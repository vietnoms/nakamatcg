import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { products, unitGroups, units } from "@/db/schema";
import { detectMapping, parseCsv, parseRows } from "@/import/collectr";
import { applyImport, planImport } from "@/server/import";
import { testDb } from "./db";

const HEADER = "Portfolio Name,Category,Set,Product Name,Card Number,Rarity,Variance,Grade,Card Condition,Average Cost Paid,Quantity,Market Price (As of 2026-10-08),Price Override,Watchlist,Date Added,Notes";
const csv = (...lines: string[]) => {
  const { headers, rows } = parseCsv([HEADER, ...lines].join("\n"));
  return parseRows(rows, detectMapping(headers)).items;
};
const main = csv(
  "Main,Pokemon,Obsidian Flames,Charizard ex,223/197,SIR,Holofoil,Ungraded,Lightly Played,60.0000,2,71.20,0,false,2026-05-02,",
  "Main,Pokemon,Evolving Skies,Umbreon VMAX,215/203,SR,Holofoil,Ungraded,Near Mint,900.0000,1,1412.37,0,false,2026-05-01,",
  "Main,Pokemon,151,Mew ex,151/165,DR,Holofoil,Ungraded,Near Mint,20.0000,1,30.00,0,false,2026-05-01,",
);
// scanned in Collectr from cards already in Main, plus one never imported
const vending = csv(
  "Vending,Pokemon,Evolving Skies,Umbreon VMAX,215/203,SR,Holofoil,Ungraded,Near Mint,0.0000,1,1412.37,0,false,2026-10-01,",
  "Vending,Pokemon,Obsidian Flames,Charizard ex,223/197,SIR,Holofoil,Ungraded,Near Mint,0.0000,1,80.00,0,false,2026-10-01,",
  "Vending,Pokemon,Crown Zenith,Pikachu,160/159,SR,Holofoil,Ungraded,Near Mint,0.0000,1,40.00,0,false,2026-10-01,",
);
const move = { moveExisting: true };

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDb());
  await applyImport(db, main, "main.csv");
});
afterAll(async () => close());

const inGroup = async (name: string) => {
  const [g] = await db.select().from(unitGroups).where(eq(unitGroups.name, name));
  if (!g) return [];
  return db
    .select({ id: units.id, name: products.name, condition: products.condition, cost: units.costCents, status: units.status })
    .from(units)
    .innerJoin(products, eq(products.id, units.productId))
    .where(eq(units.groupId, g.id));
};

describe("moving cards I already have into a scanned portfolio's group", () => {
  it("without moving, leaves cards already imported where they are and duplicates a card scanned in another condition", async () => {
    // Umbreon: nothing (already imported); Charizard ex NM: a second copy of the LP one; Pikachu: new
    expect(await planImport(db, vending)).toMatchObject({ newUnits: 2, moved: 0 });
  });

  it("moves my copies, keeping their cost, and adds only cards it can't find", async () => {
    const plan = await planImport(db, vending, { kind: "own" }, move);
    expect(plan).toMatchObject({ moved: 2, newUnits: 1 });
    const res = await applyImport(db, vending, "vending.csv", { kind: "own" }, move);
    expect(res).toMatchObject({ moved: 2, newUnits: 1 });

    const v = await inGroup("Vending");
    expect(v.map((u) => [u.name, u.condition, u.cost]).sort()).toEqual([
      // scanned as NM, owned as LP: the LP copy moved, with what I paid
      ["Charizard ex", "LP", 6000],
      ["Pikachu", "NM", null],
      ["Umbreon VMAX", "NM", 90000],
    ]);
    const m = await inGroup("Main");
    expect(m.map((u) => u.name).sort()).toEqual(["Charizard ex", "Mew ex"]);
  });

  it("is safe to run again, and does not bring back a card sold from the group", async () => {
    expect(await planImport(db, vending, { kind: "own" }, move)).toMatchObject({ moved: 0, newUnits: 0 });
    const umbreon = (await inGroup("Vending")).find((u) => u.name === "Umbreon VMAX")!;
    await db.update(units).set({ status: "sold" }).where(eq(units.id, umbreon.id));
    expect(await planImport(db, vending, { kind: "own" }, move)).toMatchObject({ moved: 0, newUnits: 0 });
  });

  it("never takes a card from my PC", async () => {
    const mew = (await inGroup("Main")).find((u) => u.name === "Mew ex")!;
    const [pc] = await db.insert(unitGroups).values({ name: "PC", kind: "personal" }).returning();
    await db.update(units).set({ groupId: pc!.id }).where(eq(units.id, mew.id));
    const withMew = [...vending, ...csv("Vending,Pokemon,151,Mew ex,151/165,DR,Holofoil,Ungraded,Near Mint,0.0000,1,30.00,0,false,2026-10-01,")];
    // the PC copy stays put; Mew was imported before, so no new copy either
    expect(await planImport(db, withMew, { kind: "own" }, move)).toMatchObject({ moved: 0, newUnits: 0 });
  });
});
