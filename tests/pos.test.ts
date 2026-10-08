import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { products, units } from "@/db/schema";
import { posSnapshot } from "@/server/pos";
import { testDb } from "./db";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await testDb());
  const [p] = await db.insert(products).values({ kind: "slab", name: "Pikachu", grader: "PSA", grade: "10", naturalKey: "k", marketCents: 31000 }).returning();
  await db.insert(units).values([
    { code: "P00001", productId: p!.id, source: "import", priceCents: 31000 },
    { code: "P00002", productId: p!.id, source: "import", status: "removed", updatedAt: new Date("2026-01-01T00:00:00Z") },
  ]);
});
afterAll(async () => close());

describe("posSnapshot", () => {
  it("a full snapshot has in-stock units with display fields, settings, and the server clock", async () => {
    const s = await posSnapshot(db, null);
    expect(s.full).toBe(true);
    expect(s.units.map((u) => u.code)).toEqual(["P00001"]);
    expect(s.units[0]).toMatchObject({ badge: "PSA 10", priceCents: 31000, kind: "slab", status: "in_stock" });
    expect(s.products).toHaveLength(1);
    expect(s.settings.paymentMethods.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(s.serverTime))).toBe(false);
  });

  it("a delta has only what changed since the last snapshot", async () => {
    const first = await posSnapshot(db, null);
    const later = new Date(Date.parse(first.serverTime) + 60_000);
    expect((await posSnapshot(db, later)).units).toHaveLength(0);

    await db.update(units).set({ status: "sold", updatedAt: new Date(later.getTime() + 1000) }).where(eq(units.code, "P00001"));
    const delta = await posSnapshot(db, later);
    expect(delta.full).toBe(false);
    expect(delta.units.map((u) => [u.code, u.status])).toEqual([["P00001", "sold"]]);
  });
});
