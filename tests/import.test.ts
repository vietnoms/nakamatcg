import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { priceHistory, products, units } from "@/db/schema";
import { detectMapping, parseCsv, parseRows } from "@/import/collectr";
import { applyImport, planImport } from "@/server/import";
import { labelQueue, markPrinted, pricingRows, requestReprint, setProductPrice } from "@/server/inventory";
import { testDb } from "./db";

const csv = readFileSync(path.join(__dirname, "../fixtures/collectr/sample.csv"), "utf8");
const parse = (text: string) => {
  const { headers, rows } = parseCsv(text);
  return parseRows(rows, detectMapping(headers)).items;
};

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(async () => close());

describe("import", () => {
  it("plans one unit per copy and applies it", async () => {
    const items = parse(csv);
    const plan = await planImport(db, items);
    expect(plan).toMatchObject({ newProducts: 6, priceChanges: 0, newUnits: 1 + 2 + 1 + 3 + 4 + 1 });

    const res = await applyImport(db, items, "sample.csv");
    expect(res.newUnits).toBe(12);
    const all = await db.select().from(units);
    expect(all).toHaveLength(12);
    expect(new Set(all.map((u) => u.code)).size).toBe(12);
    expect(all.every((u) => u.status === "in_stock" && u.priceCents === null)).toBe(true);
    expect((await db.select().from(priceHistory)).length).toBe(6);
  });

  it("re-importing the same file changes nothing", async () => {
    const plan = await planImport(db, parse(csv));
    expect(plan).toMatchObject({ newProducts: 0, priceChanges: 0, newUnits: 0 });
  });

  it("a re-import updates prices and adds only extra copies", async () => {
    const bumped = csv
      .replace("$71.20", "$80.00")
      .replace("Lightly Played,$60.00,2,", "Lightly Played,$60.00,3,");
    const res = await applyImport(db, parse(bumped), "bumped.csv");
    expect(res).toMatchObject({ newProducts: 0, priceChanges: 1, newUnits: 1 });
    const [zard] = await db.select().from(products).where(eq(products.name, "Charizard ex"));
    expect(zard?.marketCents).toBe(8000);
    const copies = await db.select().from(units).where(eq(units.productId, zard!.id));
    expect(copies).toHaveLength(3);
  });

  it("does not re-add a copy that was sold but is still in Collectr", async () => {
    const [zard] = await db.select().from(products).where(eq(products.name, "Charizard ex"));
    const [one] = await db.select().from(units).where(eq(units.productId, zard!.id)).limit(1);
    await db.update(units).set({ status: "sold" }).where(eq(units.id, one!.id));
    const plan = await planImport(db, parse(csv.replace("Lightly Played,$60.00,2,", "Lightly Played,$60.00,3,")));
    expect(plan.newUnits).toBe(0);
  });
});

describe("pricing and labels", () => {
  it("prices every in-stock copy and queues their stickers", async () => {
    const rows = await pricingRows(db);
    const umbreon = rows.find((r) => r.name.startsWith("Umbreon"))!;
    expect(umbreon).toMatchObject({ inStock: 1, priceCents: null, marketCents: 141237 });

    await setProductPrice(db, umbreon.productId, 140000);
    const zard = rows.find((r) => r.name === "Charizard ex")!;
    expect(zard.inStock).toBe(2);
    await setProductPrice(db, zard.productId, 7500);

    const queue = await labelQueue(db);
    expect(queue.map((q) => q.priceCents).sort()).toEqual([140000, 7500, 7500].sort());
  });

  it("printing clears the queue; a new price or a reprint request puts it back", async () => {
    const queue = await labelQueue(db);
    expect(await markPrinted(db, queue.map((q) => q.unitId))).toBe(3);
    expect(await labelQueue(db)).toHaveLength(0);

    const [u] = await db.select().from(units).where(eq(units.id, queue[0]!.unitId));
    expect(u?.stickeredPriceCents).toBe(u?.priceCents);
    expect(u?.stickeredMarketCents).not.toBeNull();

    const zard = (await pricingRows(db)).find((r) => r.name === "Charizard ex")!;
    await setProductPrice(db, zard.productId, 8000);
    expect(await labelQueue(db)).toHaveLength(2);

    await markPrinted(db, (await labelQueue(db)).map((q) => q.unitId));
    await requestReprint(db, [queue[0]!.unitId]);
    expect((await labelQueue(db)).map((q) => q.unitId)).toEqual([queue[0]!.unitId]);
  });
});
