import "server-only";
import { and, asc, desc, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, products, transactionLines, transactions, units } from "@/db/schema";
import { allocate } from "@/lib/allocate";
import type { ProductInput } from "@/lib/ops";
import { suggestPrice } from "@/lib/pricing";
import { productFor } from "./ops";
import { photoIds } from "./photos";
import { getSettings } from "./settings";

export type PendingUnit = {
  unitId: string;
  /** false once identified (it stays listed a while so its pile's cost can be re-split) */
  pending: boolean;
  code: string;
  status: string;
  kind: string;
  name: string;
  costCents: number | null;
  note: string;
};

export type PendingDeal = {
  dealId: string;
  occurredAt: Date;
  kind: string;
  eventName: string;
  photoIds: string[];
  units: PendingUnit[];
};

/**
 * Cards taken in at the table as quick placeholders, by the deal they came in on (newest first)
 * with that deal's photos: those still to identify, plus the rest of a deal identified in the last
 * 14 days, so its pile's cost can still be re-split. Sold ones are listed too.
 */
export async function pendingIntake(db: Db): Promise<PendingDeal[]> {
  const rows = await db
    .select({
      dealId: transactions.id,
      occurredAt: transactions.occurredAt,
      kind: transactions.kind,
      eventName: events.name,
      unitId: units.id,
      pending: units.detailsPending,
      code: units.code,
      status: units.status,
      productKind: products.kind,
      name: products.name,
      costCents: units.costCents,
      note: units.note,
    })
    .from(units)
    .innerJoin(products, eq(products.id, units.productId))
    .innerJoin(transactionLines, and(eq(transactionLines.unitId, units.id), eq(transactionLines.direction, "in")))
    .innerJoin(transactions, eq(transactions.id, transactionLines.transactionId))
    .leftJoin(events, eq(events.id, transactions.eventId))
    .where(and(or(eq(units.detailsPending, true), sql`${units.identifiedAt} > now() - interval '14 days'`), ne(units.status, "removed")))
    .orderBy(desc(transactions.occurredAt), asc(units.code));

  const byDeal = new Map<string, PendingDeal>();
  for (const r of rows) {
    const d = byDeal.get(r.dealId) ?? { dealId: r.dealId, occurredAt: r.occurredAt, kind: r.kind, eventName: r.eventName ?? "", photoIds: [], units: [] };
    d.units.push({ unitId: r.unitId, pending: r.pending, code: r.code, status: r.status, kind: r.productKind, name: r.name, costCents: r.costCents, note: r.note });
    byDeal.set(r.dealId, d);
  }
  const photos = await photoIds(db, [...byDeal.keys()]);
  for (const d of byDeal.values()) d.photoIds = photos.get(d.dealId) ?? [];
  return [...byDeal.values()];
}

export async function pendingCount(db: Db): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(units)
    .where(and(eq(units.detailsPending, true), ne(units.status, "removed")));
  return r?.n ?? 0;
}

/**
 * Says which card a placeholder is: the unit moves to that product (found or made, as at the POS),
 * keeps its code and cost, and, if still in stock and unpriced, takes the suggested price so its
 * sticker queues. Past deals show the card through the unit, so no append-only row changes.
 */
export async function identifyUnit(db: Db, unitId: string, product: ProductInput, priceCents: number | null): Promise<void> {
  const rule = (await getSettings(db)).pricing;
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [u] = await tx.select({ status: units.status, priceCents: units.priceCents }).from(units).where(eq(units.id, unitId)).for("update");
    if (!u) throw new Error("That card is gone.");
    const productId = await productFor(tx, product);
    if (product.marketCents !== null) {
      // the catalog's price is newer than whatever the product had
      await tx.update(products).set({ marketCents: product.marketCents, marketUpdatedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(products.id, productId));
    }
    const price = u.status === "in_stock" ? (priceCents ?? u.priceCents ?? suggestPrice(product.marketCents, rule)) : u.priceCents;
    await tx.update(units).set({ productId, detailsPending: false, identifiedAt: sql`now()`, priceCents: price, updatedAt: sql`now()` }).where(eq(units.id, unitId));
  });
}

/**
 * Re-splits what a deal's identified placeholder cards cost by their market price (a slab is worth
 * more than the bulk it came in with), keeping their total. Cards bought with a real price, cards
 * still to identify, and sold cards (their cost is on the sale) keep theirs. Cards with no market
 * price weigh what they cost now. Returns how many changed.
 */
export async function resplitByMarket(db: Db, dealId: string): Promise<number> {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const rows = await tx
      .select({ id: units.id, cost: units.costCents, market: products.marketCents })
      .from(transactionLines)
      .innerJoin(units, eq(units.id, transactionLines.unitId))
      .innerJoin(products, eq(products.id, units.productId))
      .where(and(eq(transactionLines.transactionId, dealId), eq(transactionLines.direction, "in"), eq(units.status, "in_stock"), isNotNull(units.identifiedAt)))
      .orderBy(asc(units.code));
    if (rows.length < 2) return 0;
    const total = rows.reduce((n, r) => n + (r.cost ?? 0), 0);
    const parts = allocate(total, rows.map((r) => r.market ?? r.cost ?? 0));
    let changed = 0;
    for (const [i, r] of rows.entries()) {
      if (parts[i] === r.cost) continue;
      await tx.update(units).set({ costCents: parts[i]!, updatedAt: sql`now()` }).where(eq(units.id, r.id));
      changed++;
    }
    return changed;
  });
}
