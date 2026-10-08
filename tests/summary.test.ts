import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { products, units } from "@/db/schema";
import type { DealOp } from "@/lib/ops";
import { DEFAULT_PAYMENT_METHODS } from "@/lib/settings";
import { applyOps } from "@/server/ops";
import { createEvent, eventDays, summarize } from "@/server/summary";
import { testDb } from "./db";

let db: Db;
let close: () => Promise<void>;
let eventId: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  ({ db, close } = await testDb());
  eventId = await createEvent(db, { name: "Fall Show", startsOn: "2026-10-10", endsOn: "2026-10-11", startingCashCents: 20000 });
  const [p] = await db.insert(products).values({ kind: "raw", name: "Card", naturalKey: "k", marketCents: 1000 }).returning();
  for (const [code, cost] of [["S00001", 400], ["S00002", 600], ["S00003", null]] as const) {
    const [u] = await db.insert(units).values({ code, productId: p!.id, costCents: cost, source: "import", priceCents: 1000 }).returning();
    ids[code] = u!.id;
  }
});
afterAll(async () => close());

const at = "2026-10-10T19:00:00.000Z"; // noon in Los Angeles
const deal = (o: Partial<DealOp>): DealOp => ({
  type: "deal", id: randomUUID(), kind: "sale", occurredAt: at, eventId, note: "", device: "", out: [], misc: [], in: [], payments: [], ...o,
});

describe("summarize", () => {
  it("adds up revenue, cost, fees, purchases, and the cash box, ignoring voided deals", async () => {
    const bundle = deal({
      out: [
        { unitId: ids.S00001!, amountCents: 900, stickerCents: 1000 },
        { unitId: ids.S00002!, amountCents: 900, stickerCents: 1000 },
      ],
      payments: [{ method: "card", direction: "in", amountCents: 1800 }],
    });
    const cash = deal({ misc: [{ description: "bulk", amountCents: 300 }], payments: [{ method: "cash", direction: "in", amountCents: 300 }] });
    const buy = deal({
      kind: "buy",
      in: [{ unitId: randomUUID(), code: "B00001", product: { kind: "raw", name: "Bought", setName: "", cardNumber: "", variant: "", condition: "", grader: "", grade: "", cert: "", marketCents: null }, costCents: 500, priceCents: null }],
      payments: [{ method: "cash", direction: "out", amountCents: 500 }],
    });
    const oops = deal({ out: [{ unitId: ids.S00003!, amountCents: 1000, stickerCents: 1000 }], payments: [{ method: "cash", direction: "in", amountCents: 1000 }] });
    const undo = { type: "void" as const, id: randomUUID(), voidsId: oops.id, occurredAt: at, note: "", device: "" };
    await applyOps(db, [bundle, cash, buy, oops, undo]);

    const s = await summarize(db, { eventId, tz: "America/Los_Angeles", methods: DEFAULT_PAYMENT_METHODS, startingCashCents: 20000 });
    expect(s).toMatchObject({
      revenueCents: 2100,
      cogsCents: 1000,
      unknownCostLines: 0,
      cardsSold: 2,
      boughtCents: 500,
      cardsBought: 1,
      feesCents: Math.round(1800 * 0.026),
      cashBoxCents: 20000 + 300 - 500,
    });
    expect(s.profitCents).toBe(2100 - 1000 - 47);
    expect(s.deals).toHaveLength(4);
    expect(s.deals.find((d) => d.id === oops.id)?.voided).toBe(true);
    expect((await db.select().from(units).where(eq(units.id, ids.S00003!)))[0]?.status).toBe("in_stock");
  });

  it("filters to one local day and lists the days", async () => {
    expect(await eventDays(db, eventId, "America/Los_Angeles")).toEqual(["2026-10-10"]);
    const none = await summarize(db, { eventId, day: "2026-10-11", tz: "America/Los_Angeles", methods: DEFAULT_PAYMENT_METHODS });
    expect(none.deals).toHaveLength(0);
  });
});
