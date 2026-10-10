import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { products, units } from "@/db/schema";
import type { ProductInput } from "@/lib/ops";
import { inventoryCounts, labelQueue, pricingRows } from "@/server/inventory";
import { saveSetting } from "@/server/settings";
import { addStock } from "@/server/stock";
import { testDb } from "./db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(async () => close());

const etb: ProductInput = {
  kind: "sealed",
  name: "Prismatic Evolutions Elite Trainer Box",
  setName: "SV: Prismatic Evolutions",
  cardNumber: "",
  variant: "",
  condition: "NM",
  grader: "PSA",
  grade: "",
  cert: "",
  marketCents: 8999,
};

describe("adding stock by hand", () => {
  it("makes one unit per copy with its cost and price, and reuses the product next time", async () => {
    const a = await addStock(db, { product: etb, qty: 3, costCents: 5500, priceCents: 9000, groupId: null });
    expect(a.codes).toHaveLength(3);
    const b = await addStock(db, { product: { ...etb, marketCents: 9500 }, qty: 2, costCents: 5200, priceCents: null, groupId: null });
    expect(b.productId).toBe(a.productId);
    const copies = await db.select().from(units).where(eq(units.productId, a.productId));
    expect(copies).toHaveLength(5);
    expect(copies.every((u) => u.source === "manual" && u.status === "in_stock")).toBe(true);
    expect(copies.map((u) => u.costCents).sort()).toEqual([5200, 5200, 5500, 5500, 5500]);
    const [p] = await db.select().from(products).where(eq(products.id, a.productId));
    expect(p).toMatchObject({ kind: "sealed", condition: "", grader: "", marketCents: 9500 });
    expect((await pricingRows(db)).find((r) => r.productId === a.productId)?.inStock).toBe(5);
  });
});

describe("stickers for sealed", () => {
  it("are left out of the queue unless Settings turns them on", async () => {
    expect(await labelQueue(db)).toHaveLength(0);
    expect((await inventoryCounts(db)).needLabels).toBe(0);
    await saveSetting(db, "stickerSealed", true);
    expect(await labelQueue(db)).toHaveLength(3);
    expect((await inventoryCounts(db)).needLabels).toBe(3);
    await saveSetting(db, "stickerSealed", false);
  });

  it("still prints a sealed sticker asked for by code", async () => {
    const [one] = await db.select().from(units).where(eq(units.priceCents, 9000)).limit(1);
    await db.update(units).set({ reprint: true }).where(eq(units.id, one!.id));
    expect((await labelQueue(db)).map((l) => l.code)).toEqual([one!.code]);
  });
});
