import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { priceHistory, products, units } from "@/db/schema";
import { detectMapping, parseCsv, parseRows } from "@/import/collectr";
import { changeCondition } from "@/server/condition";
import { applyImport, planImport } from "@/server/import";
import { pricingRows } from "@/server/inventory";
import { testDb } from "./db";

const csv = readFileSync(path.join(__dirname, "../fixtures/collectr/sample.csv"), "utf8");
const parse = (text: string) => {
  const { headers, rows } = parseCsv(text);
  return parseRows(rows, detectMapping(headers)).items;
};

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDb());
  await applyImport(db, parse(csv), "sample.csv");
});
afterAll(async () => close());

const row = async (name: string, condition?: string) =>
  (await pricingRows(db)).find((r) => r.name === name && (condition === undefined || r.condition === condition));
const copies = async (productId: string) => db.select().from(units).where(eq(units.productId, productId));

describe("changing a card's condition", () => {
  it("moves the copy to the card in the new condition, with an estimated market and the new suggested price", async () => {
    const nm = (await row("Umbreon VMAX (Alternate Full Art)", "NM"))!;
    const res = await changeCondition(db, { productId: nm.productId }, "LP");
    // 85% of $1,412.37
    expect(res).toMatchObject({ moved: 1, marketCents: 120051, estimated: true });
    const lp = (await row("Umbreon VMAX (Alternate Full Art)", "LP"))!;
    expect(lp.marketCents).toBe(120051);
    // the default rule rounds up to $5 steps over $50
    expect(lp.priceCents).toBe(120500);
    expect(await row("Umbreon VMAX (Alternate Full Art)", "NM")).toBeUndefined();
    const hist = await db.select().from(priceHistory).where(and(eq(priceHistory.productId, lp.productId), eq(priceHistory.source, "condition")));
    expect(hist.map((h) => h.marketCents)).toEqual([120051]);
    const [u] = await copies(lp.productId);
    expect(u!.importedProductId).toBe(nm.productId);
  });

  it("does not import the copy again, whether or not Collectr was updated too", async () => {
    expect((await planImport(db, parse(csv))).newUnits).toBe(0);
    const updated = csv.replace("Ungraded,Near Mint,900.0000", "Ungraded,Lightly Played,900.0000");
    const plan = await planImport(db, parse(updated));
    expect(plan.rows.find((r) => r.name.startsWith("Umbreon"))).toMatchObject({ newUnits: 0, isNewProduct: false });
  });

  it("changes only the ticked copy, and queues its sticker for reprint", async () => {
    const lp = (await row("Charizard ex", "LP"))!;
    const [a, b] = await copies(lp.productId);
    await db.update(units).set({ priceCents: 7200, stickeredPriceCents: 7200, stickeredAt: new Date() }).where(eq(units.id, a!.id));
    const res = await changeCondition(db, { unitIds: [a!.id] }, "NM");
    // $71.20 is 85% of Near Mint: $83.76
    expect(res).toMatchObject({ moved: 1, marketCents: 8376, estimated: true });
    const [moved] = await db.select().from(units).where(eq(units.id, a!.id));
    expect(moved).toMatchObject({ priceCents: 8500, reprint: true });
    const [stayed] = await db.select().from(units).where(eq(units.id, b!.id));
    expect(stayed!.productId).toBe(lp.productId);
    expect((await planImport(db, parse(csv))).newUnits).toBe(0);
  });

  it("uses the real price when the card is already known in that condition", async () => {
    const lp = (await row("Umbreon VMAX (Alternate Full Art)", "LP"))!;
    const [u] = await copies(lp.productId);
    const res = await changeCondition(db, { unitIds: [u!.id] }, "NM");
    expect(res).toMatchObject({ moved: 1, marketCents: 141237, estimated: false });
    const [back] = await db.select().from(units).where(eq(units.id, u!.id));
    const [orig] = await db.select().from(products).where(eq(products.id, back!.productId));
    expect(orig!.condition).toBe("NM");
    expect(back!.importedProductId).toBe(back!.productId);
    expect((await planImport(db, parse(csv))).newUnits).toBe(0);
  });

  it("leaves slabs and sealed alone", async () => {
    const slab = (await pricingRows(db)).find((r) => r.kind === "slab")!;
    expect((await changeCondition(db, { productId: slab.productId }, "LP")).moved).toBe(0);
  });
});
