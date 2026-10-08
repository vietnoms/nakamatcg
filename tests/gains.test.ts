import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { products, units } from "@/db/schema";
import type { DealOp } from "@/lib/ops";
import { realizedGains, unrealizedGains } from "@/server/gains";
import { applyOps } from "@/server/ops";
import { createEvent } from "@/server/summary";
import { testDb } from "./db";

let db: Db;
let close: () => Promise<void>;
const id: Record<string, string> = {};

beforeAll(async () => {
  ({ db, close } = await testDb());
  const [zard] = await db.insert(products).values({ kind: "raw", name: "Charizard ex", condition: "NM", naturalKey: "z", marketCents: 7000, marketUpdatedAt: new Date("2026-10-08T12:00:00Z") }).returning();
  const [slab] = await db.insert(products).values({ kind: "slab", name: "Pikachu", grader: "PSA", grade: "10", naturalKey: "p", marketCents: 30000 }).returning();
  const [bare] = await db.insert(products).values({ kind: "raw", name: "Unknown market", naturalKey: "u" }).returning();
  const add = async (code: string, productId: string, costCents: number | null) => {
    const [u] = await db.insert(units).values({ code, productId, costCents, source: "import", priceCents: 1 }).returning();
    id[code] = u!.id;
  };
  await add("Z00001", zard!.id, 4000);
  await add("Z00002", zard!.id, 4000);
  await add("Z00003", zard!.id, 9000); // bought high: a loss
  await add("Z00004", zard!.id, null); // no cost in Collectr
  await add("P00001", slab!.id, 15000);
  await add("U00001", bare!.id, 500);
});
afterAll(async () => close());

describe("unrealizedGains", () => {
  it("groups copies by card and cost and computes market minus cost", async () => {
    const u = await unrealizedGains(db);
    const byCost = (name: string, cost: number) => u.rows.find((r) => r.name === name && r.costCents === cost);
    expect(byCost("Charizard ex", 4000)).toMatchObject({ qty: 2, marketCents: 7000, gainCents: 3000, gainPct: 75, totalGainCents: 6000, totalCostCents: 8000, totalMarketCents: 14000 });
    expect(byCost("Charizard ex", 9000)).toMatchObject({ qty: 1, gainCents: -2000, gainPct: -22.22, totalGainCents: -2000 });
    expect(byCost("Pikachu", 15000)).toMatchObject({ badge: "PSA 10", gainCents: 15000, gainPct: 100 });
    expect(u.rows).toHaveLength(3);
  });

  it("counts what it had to leave out, and when the prices are from", async () => {
    const u = await unrealizedGains(db);
    expect(u.unknownCost).toBe(1);
    expect(u.noMarket).toBe(1);
    expect(u.marketAsOf?.toISOString()).toBe("2026-10-08T12:00:00.000Z");
  });
});

describe("realizedGains", () => {
  it("lists cards sold or traded with their share of the deal against cost, skipping voided deals", async () => {
    const eventId = await createEvent(db, { name: "Fall Show", startsOn: "2026-10-10", endsOn: "2026-10-11", startingCashCents: 0 });
    const deal = (o: Partial<DealOp>): DealOp => ({
      type: "deal", id: randomUUID(), kind: "sale", occurredAt: "2026-10-10T19:00:00.000Z", eventId, note: "", device: "", out: [], misc: [], in: [], payments: [], ...o,
    });
    const sale = deal({
      out: [
        { unitId: id.Z00001!, amountCents: 6500, stickerCents: 7000 },
        { unitId: id.Z00004!, amountCents: 6500, stickerCents: 7000 },
      ],
      payments: [{ method: "cash", direction: "in", amountCents: 13000 }],
    });
    const voidedSale = deal({ out: [{ unitId: id.P00001!, amountCents: 30000, stickerCents: 30000 }], payments: [{ method: "cash", direction: "in", amountCents: 30000 }] });
    const undo = { type: "void" as const, id: randomUUID(), voidsId: voidedSale.id, occurredAt: "2026-10-10T19:05:00.000Z", note: "", device: "" };
    const trade = deal({
      kind: "trade",
      out: [{ unitId: id.Z00003!, amountCents: 7000, stickerCents: 7000 }],
      in: [{ unitId: randomUUID(), code: "T00001", product: { kind: "raw", name: "Mew", setName: "", cardNumber: "", variant: "", condition: "NM", grader: "", grade: "", cert: "", marketCents: null }, costCents: 7000, priceCents: null }],
      payments: [],
    });
    await applyOps(db, [sale, voidedSale, undo, trade]);

    const rows = await realizedGains(db, { eventId });
    expect(rows.map((r) => [r.code, r.how, r.soldCents, r.costCents, r.gainCents, r.eventName])).toEqual(
      expect.arrayContaining([
        ["Z00001", "sold", 6500, 4000, 2500, "Fall Show"],
        ["Z00004", "sold", 6500, null, null, "Fall Show"],
        ["Z00003", "traded", 7000, 9000, -2000, "Fall Show"],
      ]),
    );
    expect(rows).toHaveLength(3);
    // sold cards are no longer in the unrealized view
    expect((await unrealizedGains(db)).rows.find((r) => r.name === "Charizard ex" && r.costCents === 4000)?.qty).toBe(1);
  });
});
