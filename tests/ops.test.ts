import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { payments, products, syncConflicts, transactionLines, transactions, units } from "@/db/schema";
import { dealBalance, type DealOp } from "@/lib/ops";
import { applyOps } from "@/server/ops";
import { testDb } from "./db";

let db: Db;
let close: () => Promise<void>;
let productId: string;
const unit = (code: string) => db.select().from(units).where(eq(units.code, code)).then((r) => r[0]!);

beforeAll(async () => {
  ({ db, close } = await testDb());
  const [p] = await db
    .insert(products)
    .values({ kind: "raw", name: "Charizard ex", setName: "Obsidian Flames", cardNumber: "223/197", condition: "NM", naturalKey: "k1", marketCents: 7000 })
    .returning();
  productId = p!.id;
  await db.insert(units).values(
    ["AAAAA1", "AAAAA2", "AAAAA3", "AAAAA4"].map((code) => ({ code, productId, costCents: 4000, source: "import", priceCents: 7000 })),
  );
});
afterAll(async () => close());

function deal(over: Partial<DealOp>): DealOp {
  return {
    type: "deal",
    id: randomUUID(),
    kind: "sale",
    occurredAt: new Date().toISOString(),
    eventId: null,
    note: "",
    device: "test",
    out: [],
    misc: [],
    in: [],
    payments: [],
    ...over,
  };
}

describe("dealBalance", () => {
  it("is zero when goods and money match", () => {
    expect(
      dealBalance({
        out: [{ unitId: "x", amountCents: 6000, stickerCents: 7000 }],
        misc: [{ description: "bulk", amountCents: 500 }],
        in: [],
        payments: [
          { method: "cash", direction: "in", amountCents: 4000 },
          { method: "venmo", direction: "in", amountCents: 2500 },
        ],
      }),
    ).toBe(0);
  });
});

describe("applyOps", () => {
  it("records a bundle sale with split payment and marks the cards sold", async () => {
    const a = await unit("AAAAA1");
    const b = await unit("AAAAA2");
    const op = deal({
      out: [
        { unitId: a.id, amountCents: 6000, stickerCents: 7000 },
        { unitId: b.id, amountCents: 6000, stickerCents: 7000 },
      ],
      payments: [
        { method: "cash", direction: "in", amountCents: 10000 },
        { method: "venmo", direction: "in", amountCents: 2000 },
      ],
    });
    const [res] = await applyOps(db, [op]);
    expect(res).toEqual({ id: op.id, status: "applied" });
    expect((await unit("AAAAA1")).status).toBe("sold");
    const lines = await db.select().from(transactionLines).where(eq(transactionLines.transactionId, op.id));
    expect(lines.map((l) => l.costCents)).toEqual([4000, 4000]);
    expect(await db.select().from(payments).where(eq(payments.transactionId, op.id))).toHaveLength(2);
  });

  it("syncing the same op again is a no-op", async () => {
    const c = await unit("AAAAA3");
    const op = deal({ out: [{ unitId: c.id, amountCents: 7000, stickerCents: 7000 }], payments: [{ method: "cash", direction: "in", amountCents: 7000 }] });
    await applyOps(db, [op]);
    const [again] = await applyOps(db, [op]);
    expect(again?.status).toBe("duplicate");
    expect(await db.select().from(transactions).where(eq(transactions.id, op.id))).toHaveLength(1);
  });

  it("keeps a sale of an already-sold card and flags it", async () => {
    const a = await unit("AAAAA1");
    const op = deal({ out: [{ unitId: a.id, amountCents: 7000, stickerCents: 7000 }], payments: [{ method: "cash", direction: "in", amountCents: 7000 }] });
    const [res] = await applyOps(db, [op]);
    expect(res?.status).toBe("applied");
    expect(res?.conflicts).toEqual(["AAAAA1 was already sold"]);
    expect(await db.select().from(syncConflicts).where(eq(syncConflicts.transactionId, op.id))).toHaveLength(1);
  });

  it("flags a deal that does not balance but still records it", async () => {
    const op = deal({ misc: [{ description: "bulk bin", amountCents: 500 }], payments: [{ method: "cash", direction: "in", amountCents: 400 }] });
    const [res] = await applyOps(db, [op]);
    expect(res?.conflicts).toEqual(["does not balance by 100 cents"]);
  });

  it("a buy creates the product and units with the phone's ids and codes, at cost", async () => {
    const u1 = randomUUID();
    const u2 = randomUUID();
    const product = { kind: "raw" as const, name: "Pikachu", setName: "151", cardNumber: "25/165", variant: "", condition: "NM", grader: "", grade: "", cert: "", marketCents: null };
    const op = deal({
      kind: "buy",
      in: [
        { unitId: u1, code: "BBBBB1", product, costCents: 300, priceCents: 500 },
        { unitId: u2, code: "BBBBB2", product, costCents: 300, priceCents: 500 },
      ],
      payments: [{ method: "cash", direction: "out", amountCents: 600 }],
    });
    const [res] = await applyOps(db, [op]);
    expect(res).toEqual({ id: op.id, status: "applied" });
    const made = await db.select().from(units).where(inArray(units.id, [u1, u2]));
    expect(made.map((u) => [u.code, u.source, u.costCents, u.priceCents, u.status])).toEqual(
      expect.arrayContaining([
        ["BBBBB1", "buy", 300, 500, "in_stock"],
        ["BBBBB2", "buy", 300, 500, "in_stock"],
      ]),
    );
    expect(new Set(made.map((u) => u.productId)).size).toBe(1);
  });

  it("a buy of a card we already carry reuses its product; a taken code is replaced and flagged", async () => {
    const id = randomUUID();
    const op = deal({
      kind: "buy",
      in: [
        {
          unitId: id,
          code: "AAAAA4",
          product: { kind: "raw", name: "Charizard ex", setName: "Obsidian Flames", cardNumber: "223/197", variant: "", condition: "NM", grader: "", grade: "", cert: "", marketCents: null },
          costCents: 5000,
          priceCents: null,
        },
      ],
      payments: [{ method: "venmo", direction: "out", amountCents: 5000 }],
    });
    const [res] = await applyOps(db, [op]);
    const [u] = await db.select().from(units).where(eq(units.id, id));
    expect(u?.code).not.toBe("AAAAA4");
    expect(res?.conflicts?.[0]).toMatch(/^code AAAAA4 was taken/);
    // same natural key as the seeded product? It was seeded with key "k1", so the buy made its own
    // product keyed the canonical way; a second buy of the same card must reuse that one
    const again = deal({
      kind: "buy",
      in: [{ ...op.in[0]!, unitId: randomUUID(), code: "CCCCC1" }],
      payments: [{ method: "venmo", direction: "out", amountCents: 5000 }],
    });
    await applyOps(db, [again]);
    const [u2] = await db.select().from(units).where(eq(units.code, "CCCCC1"));
    expect(u2?.productId).toBe(u?.productId);
  });

  it("a trade sends my card out at its value and brings theirs in at trade-in cost", async () => {
    const d = await unit("AAAAA4");
    const theirs = randomUUID();
    const op = deal({
      kind: "trade",
      out: [{ unitId: d.id, amountCents: 7000, stickerCents: 7000 }],
      in: [
        {
          unitId: theirs,
          code: "DDDDD1",
          product: { kind: "slab", name: "Umbreon", setName: "Evolving Skies", cardNumber: "189", variant: "", condition: "", grader: "psa", grade: "9", cert: "", marketCents: 6000 },
          costCents: 5000,
          priceCents: null,
        },
      ],
      payments: [{ method: "cash", direction: "in", amountCents: 2000 }],
    });
    expect(dealBalance(op)).toBe(0);
    await applyOps(db, [op]);
    expect((await unit("AAAAA4")).status).toBe("traded_out");
    const [t] = await db.select().from(units).where(eq(units.id, theirs));
    expect(t).toMatchObject({ source: "trade_in", costCents: 5000 });
    const [p] = await db.select().from(products).where(eq(products.id, t!.productId));
    expect(p).toMatchObject({ kind: "slab", grader: "PSA", grade: "9", marketCents: 6000 });
  });

  it("a void restocks cards out and removes cards in; voiding twice is a no-op", async () => {
    const e = await db.insert(units).values({ code: "EEEEE1", productId, costCents: 1000, source: "import", priceCents: 2000 }).returning();
    const sale = deal({
      out: [{ unitId: e[0]!.id, amountCents: 2000, stickerCents: 2000 }],
      payments: [{ method: "cash", direction: "in", amountCents: 2000 }],
    });
    const buyId = randomUUID();
    const buy = deal({
      kind: "buy",
      in: [{ unitId: buyId, code: "EEEEE2", product: { kind: "sealed", name: "Booster Pack", setName: "", cardNumber: "", variant: "", condition: "", grader: "", grade: "", cert: "", marketCents: null }, costCents: 300, priceCents: null }],
      payments: [{ method: "cash", direction: "out", amountCents: 300 }],
    });
    const v1 = { type: "void" as const, id: randomUUID(), voidsId: sale.id, occurredAt: new Date().toISOString(), note: "", device: "test" };
    const v2 = { ...v1, id: randomUUID(), voidsId: buy.id };
    const v1b = { ...v1, id: randomUUID() };
    const res = await applyOps(db, [sale, buy, v1, v2, v1b]);
    expect(res.map((r) => r.status)).toEqual(["applied", "applied", "applied", "applied", "duplicate"]);
    expect((await unit("EEEEE1")).status).toBe("in_stock");
    expect((await unit("EEEEE2")).status).toBe("removed");
  });

  it("reports a malformed op as an error and keeps going", async () => {
    const good = deal({ misc: [{ description: "bulk", amountCents: 100 }], payments: [{ method: "cash", direction: "in", amountCents: 100 }] });
    const res = await applyOps(db, [{ type: "deal", id: "nope" }, good]);
    expect(res[0]?.status).toBe("error");
    expect(res[1]?.status).toBe("applied");
  });

  it("refuses to void a deal the server has never seen", async () => {
    const [res] = await applyOps(db, [{ type: "void", id: randomUUID(), voidsId: randomUUID(), occurredAt: new Date().toISOString(), note: "", device: "" }]);
    expect(res).toMatchObject({ status: "error", error: "the deal to void is not on the server" });
  });
});
