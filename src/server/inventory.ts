import "server-only";
import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { labelPrints, products, units } from "@/db/schema";
import { forSale } from "./groups";
import type { ProductKind } from "@/import/collectr";

export type PricingRow = {
  productId: string;
  kind: ProductKind;
  name: string;
  setName: string;
  cardNumber: string;
  variant: string;
  condition: string;
  grader: string;
  grade: string;
  marketCents: number | null;
  inStock: number;
  /** the price when every in-stock copy has the same one; null when unpriced or mixed */
  priceCents: number | null;
  mixedPrices: boolean;
  avgCostCents: number | null;
  needLabels: number;
};

const needsLabel = sql`(${units.priceCents} is not null and (${units.stickeredPriceCents} is distinct from ${units.priceCents} or ${units.reprint}))`;

/** Products with at least one copy in stock, for the pricing page. */
export async function pricingRows(db: Db): Promise<PricingRow[]> {
  const rows = await db
    .select({
      productId: products.id,
      kind: products.kind,
      name: products.name,
      setName: products.setName,
      cardNumber: products.cardNumber,
      variant: products.variant,
      condition: products.condition,
      grader: products.grader,
      grade: products.grade,
      marketCents: products.marketCents,
      inStock: sql<number>`count(*)::int`,
      minPrice: sql<number | null>`min(${units.priceCents})`,
      maxPrice: sql<number | null>`max(${units.priceCents})`,
      unpriced: sql<number>`count(*) filter (where ${units.priceCents} is null)::int`,
      avgCost: sql<number | null>`round(avg(${units.costCents}))::int`,
      needLabels: sql<number>`count(*) filter (where ${needsLabel})::int`,
    })
    .from(units)
    .innerJoin(products, eq(products.id, units.productId))
    .where(and(eq(units.status, "in_stock"), forSale))
    .groupBy(products.id)
    .orderBy(asc(products.setName), asc(products.name), asc(products.cardNumber));

  return rows.map((r) => {
    const uniform = r.unpriced === 0 && r.minPrice !== null && r.minPrice === r.maxPrice;
    return {
      productId: r.productId,
      kind: r.kind as ProductKind,
      name: r.name,
      setName: r.setName,
      cardNumber: r.cardNumber,
      variant: r.variant,
      condition: r.condition,
      grader: r.grader,
      grade: r.grade,
      marketCents: r.marketCents,
      inStock: r.inStock,
      priceCents: uniform ? r.minPrice : null,
      mixedPrices: !uniform && r.unpriced < r.inStock,
      avgCostCents: r.avgCost,
      needLabels: r.needLabels,
    };
  });
}

/** Sets the price of every in-stock copy of a product that is for sale (not in the PC). A changed price puts the copy in the label queue. */
export async function setProductPrice(db: Db, productId: string, priceCents: number | null): Promise<void> {
  await db
    .update(units)
    .set({ priceCents, updatedAt: sql`now()` })
    .where(and(eq(units.productId, productId), eq(units.status, "in_stock"), forSale));
}

export async function setProductPrices(db: Db, prices: { productId: string; priceCents: number }[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const p of prices) await setProductPrice(tx as unknown as Db, p.productId, p.priceCents);
  });
}

export type LabelQueueItem = {
  unitId: string;
  code: string;
  priceCents: number;
  stickeredPriceCents: number | null;
  reprint: boolean;
  kind: ProductKind;
  name: string;
  setName: string;
  cardNumber: string;
  variant: string;
  condition: string;
  grader: string;
  grade: string;
};

/** In-stock units whose sticker is missing, out of date, or asked to be reprinted. */
export async function labelQueue(db: Db): Promise<LabelQueueItem[]> {
  const rows = await db
    .select({
      unitId: units.id,
      code: units.code,
      priceCents: units.priceCents,
      stickeredPriceCents: units.stickeredPriceCents,
      reprint: units.reprint,
      kind: products.kind,
      name: products.name,
      setName: products.setName,
      cardNumber: products.cardNumber,
      variant: products.variant,
      condition: products.condition,
      grader: products.grader,
      grade: products.grade,
    })
    .from(units)
    .innerJoin(products, eq(products.id, units.productId))
    .where(and(eq(units.status, "in_stock"), forSale, isNotNull(units.priceCents), or(sql`${units.stickeredPriceCents} is distinct from ${units.priceCents}`, eq(units.reprint, true))))
    .orderBy(asc(products.setName), asc(products.name), asc(products.cardNumber), asc(units.code));
  return rows.map((r) => ({ ...r, priceCents: r.priceCents!, kind: r.kind as ProductKind }));
}

/** Records that these units' stickers now show their current price. */
export async function markPrinted(db: Db, unitIds: string[]): Promise<number> {
  if (unitIds.length === 0) return 0;
  return db.transaction(async (tx) => {
    const done = await tx
      .update(units)
      .set({
        stickeredPriceCents: sql`${units.priceCents}`,
        stickeredAt: sql`now()`,
        stickeredMarketCents: sql`(select ${products.marketCents} from ${products} where ${products.id} = ${units.productId})`,
        reprint: false,
        updatedAt: sql`now()`,
      })
      .where(and(inArray(units.id, unitIds), isNotNull(units.priceCents)))
      .returning({ id: units.id, priceCents: units.priceCents });
    if (done.length) await tx.insert(labelPrints).values(done.map((d) => ({ unitId: d.id, priceCents: d.priceCents! })));
    return done.length;
  });
}

export async function requestReprint(db: Db, unitIds: string[]): Promise<void> {
  if (unitIds.length === 0) return;
  await db.update(units).set({ reprint: true, updatedAt: sql`now()` }).where(inArray(units.id, unitIds));
}

export type UnitView = {
  id: string;
  code: string;
  status: string;
  priceCents: number | null;
  stickeredPriceCents: number | null;
  stickeredAt: Date | null;
  costCents: number | null;
  source: string;
  kind: ProductKind;
  name: string;
  setName: string;
  cardNumber: string;
  variant: string;
  condition: string;
  grader: string;
  grade: string;
  cert: string;
  marketCents: number | null;
};

export async function unitByCode(db: Db, code: string): Promise<UnitView | null> {
  const [r] = await db
    .select({
      id: units.id,
      code: units.code,
      status: units.status,
      priceCents: units.priceCents,
      stickeredPriceCents: units.stickeredPriceCents,
      stickeredAt: units.stickeredAt,
      costCents: units.costCents,
      source: units.source,
      kind: products.kind,
      name: products.name,
      setName: products.setName,
      cardNumber: products.cardNumber,
      variant: products.variant,
      condition: products.condition,
      grader: products.grader,
      grade: products.grade,
      cert: products.cert,
      marketCents: products.marketCents,
    })
    .from(units)
    .innerJoin(products, eq(products.id, units.productId))
    .where(eq(units.code, code))
    .limit(1);
  return r ? { ...r, kind: r.kind as ProductKind } : null;
}

/** Stock counts for the home page. Cards in the personal collection are not stock. */
export async function inventoryCounts(db: Db) {
  const [r] = await db
    .select({
      inStock: sql<number>`count(*) filter (where ${units.status} = 'in_stock')::int`,
      unpriced: sql<number>`count(*) filter (where ${units.status} = 'in_stock' and ${units.priceCents} is null)::int`,
      needLabels: sql<number>`count(*) filter (where ${units.status} = 'in_stock' and ${needsLabel})::int`,
      sold: sql<number>`count(*) filter (where ${units.status} = 'sold')::int`,
      stockValueCents: sql<number>`coalesce(sum(${units.priceCents}) filter (where ${units.status} = 'in_stock'), 0)::int`,
    })
    .from(units)
    .where(forSale);
  return r ?? { inStock: 0, unpriced: 0, needLabels: 0, sold: 0, stockValueCents: 0 };
}
