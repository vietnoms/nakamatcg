import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { products, units } from "@/db/schema";
import { placeholderProduct, splitPile } from "@/lib/intake";
import type { DealOp } from "@/lib/ops";
import { identifyUnit, pendingCount, pendingIntake, resplitByMarket } from "@/server/intake";
import { applyOps } from "@/server/ops";
import { getPhoto, photoIds, savePhoto } from "@/server/photos";
import { testDb } from "./db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(async () => close());

const dealId = randomUUID();
const codes = ["PAKE01", "PAKE02", "PAKE03", "QWCK01"];
const unit = (code: string) => db.select().from(units).where(eq(units.code, code)).then((r) => r[0]!);

describe("quick intake and Needs details", () => {
  it("takes a pile in as placeholders with codes, cost split evenly, and lists them to identify", async () => {
    const pile = splitPile({ raw: 2, slab: 1, sealed: 0 }, 8500);
    const kinds = pile.flatMap((p) => p.costs.map((c) => ({ kind: p.kind, c })));
    const op: DealOp = {
      type: "deal",
      id: dealId,
      kind: "buy",
      occurredAt: new Date().toISOString(),
      eventId: null,
      note: "",
      device: "test",
      out: [],
      misc: [],
      in: [
        ...kinds.map((k, i) => ({ unitId: randomUUID(), code: codes[i]!, product: placeholderProduct(k.kind), costCents: k.c, priceCents: null, pending: true, note: "binder" })),
        // a quick item with a real amount and a hint
        { unitId: randomUUID(), code: codes[3]!, product: placeholderProduct("slab", "Charizard PSA 9?"), costCents: 30000, priceCents: null, pending: true, note: "" },
      ],
      payments: [{ method: "cash", direction: "out", amountCents: 38500 }],
    };
    const res = (await applyOps(db, [op]))[0]!;
    expect(res.error ?? "").toBe("");
    expect(res.status).toBe("applied");
    const first = await unit("PAKE01");
    expect(first).toMatchObject({ status: "in_stock", detailsPending: true, note: "binder", priceCents: null });
    expect(await pendingCount(db)).toBe(4);
    const [d] = await pendingIntake(db);
    expect(d!.dealId).toBe(dealId);
    expect(d!.units.map((u) => [u.code, u.name, u.pending])).toEqual([
      ["PAKE01", "Unidentified card", true],
      ["PAKE02", "Unidentified card", true],
      ["PAKE03", "Unidentified slab", true],
      ["QWCK01", "Charizard PSA 9?", true],
    ]);
  });

  it("keeps the deal's photos, once each, and only for a deal the server has", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const p = { id: randomUUID(), dealId, takenAt: new Date(), mime: "image/jpeg", bytes };
    expect(await savePhoto(db, { ...p, dealId: randomUUID() })).toBe("no-deal");
    expect(await savePhoto(db, p)).toBe("saved");
    expect(await savePhoto(db, p)).toBe("duplicate");
    expect((await photoIds(db, [dealId])).get(dealId)).toEqual([p.id]);
    expect([...(await getPhoto(db, p.id))!.bytes]).toEqual([...bytes]);
    expect((await pendingIntake(db))[0]!.photoIds).toEqual([p.id]);
  });

  it("identifying a card points it at the real product with a suggested price; the pile cost re-splits by market", async () => {
    const card = { kind: "raw" as const, name: "Pikachu", setName: "Crown Zenith", cardNumber: "160/159", variant: "", condition: "NM", grader: "", grade: "", cert: "", marketCents: 1000 };
    await identifyUnit(db, (await unit("PAKE01")).id, card, null);
    await identifyUnit(db, (await unit("PAKE02")).id, { ...card, name: "Eevee", cardNumber: "1/1", marketCents: 1000 }, 500);
    await identifyUnit(db, (await unit("PAKE03")).id, { ...card, kind: "slab", name: "Umbreon", grader: "PSA", grade: "10", marketCents: 8000 }, null);

    const one = await unit("PAKE01");
    const [prod] = await db.select().from(products).where(eq(products.id, one.productId));
    expect(prod).toMatchObject({ name: "Pikachu", marketCents: 1000 });
    expect(one.detailsPending).toBe(false);
    expect(one.identifiedAt).not.toBeNull();
    expect(one.priceCents).toBe(1000);
    expect((await unit("PAKE02")).priceCents).toBe(500);
    expect(await pendingCount(db)).toBe(1);

    // the pile's $85 now follows market: $10, $10, $80 → 850, 850, 6800; the quick item keeps its $300
    expect(await resplitByMarket(db, dealId)).toBeGreaterThan(0);
    const costs = await Promise.all(["PAKE01", "PAKE02", "PAKE03"].map(async (c) => (await unit(c)).costCents));
    expect(costs).toEqual([850, 850, 6800]);
    expect((await unit("QWCK01")).costCents).toBe(30000);

    // identified cards stay listed a while, so the pile can still be re-split
    const [d] = await pendingIntake(db);
    expect(d!.units.filter((u) => u.pending).map((u) => u.code)).toEqual(["QWCK01"]);
    expect(d!.units).toHaveLength(4);
  });
});
