import "server-only";
import { and, desc, eq, inArray, isNotNull, max, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, products, transactionLines, transactions, units } from "@/db/schema";
import { badgeFor, type ProductKind } from "@/import/collectr";

/** Copies of one card in stock at one cost: what they cost me and what they are worth now. */
export type UnrealizedRow = {
  productId: string;
  kind: ProductKind;
  name: string;
  setName: string;
  cardNumber: string;
  variant: string;
  badge: string;
  qty: number;
  costCents: number;
  marketCents: number;
  /** market minus cost, per copy */
  gainCents: number;
  /** gain as a percentage of cost; null when the cost was 0 */
  gainPct: number | null;
  totalCostCents: number;
  totalMarketCents: number;
  totalGainCents: number;
};

export type Unrealized = {
  rows: UnrealizedRow[];
  /** in-stock copies left out because Collectr had no cost for them */
  unknownCost: number;
  /** in-stock copies left out because there is no market price */
  noMarket: number;
  /** the newest market price in the set, for "as of" */
  marketAsOf: Date | null;
};

const pct = (gain: number, cost: number) => (cost > 0 ? Math.round((gain * 10000) / cost) / 100 : null);

/**
 * Unrealized gain or loss on what is in stock: current market price (the last Collectr import)
 * minus what each copy cost. Copies of one card at different costs are separate rows.
 */
export async function unrealizedGains(db: Db): Promise<Unrealized> {
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
      costCents: units.costCents,
      qty: sql<number>`count(*)::int`,
    })
    .from(units)
    .innerJoin(products, eq(products.id, units.productId))
    .where(and(eq(units.status, "in_stock"), isNotNull(units.costCents), isNotNull(products.marketCents)))
    .groupBy(products.id, units.costCents);

  const [left] = await db
    .select({
      unknownCost: sql<number>`count(*) filter (where ${units.costCents} is null)::int`,
      noMarket: sql<number>`count(*) filter (where ${units.costCents} is not null and ${products.marketCents} is null)::int`,
      asOf: max(products.marketUpdatedAt),
    })
    .from(units)
    .innerJoin(products, eq(products.id, units.productId))
    .where(eq(units.status, "in_stock"));

  return {
    rows: rows.map((r) => {
      const cost = r.costCents!;
      const market = r.marketCents!;
      const gain = market - cost;
      return {
        productId: r.productId,
        kind: r.kind as ProductKind,
        name: r.name,
        setName: r.setName,
        cardNumber: r.cardNumber,
        variant: r.variant,
        badge: badgeFor({ kind: r.kind as ProductKind, condition: r.condition, grader: r.grader, grade: r.grade }),
        qty: r.qty,
        costCents: cost,
        marketCents: market,
        gainCents: gain,
        gainPct: pct(gain, cost),
        totalCostCents: cost * r.qty,
        totalMarketCents: market * r.qty,
        totalGainCents: gain * r.qty,
      };
    }),
    unknownCost: left?.unknownCost ?? 0,
    noMarket: left?.noMarket ?? 0,
    marketAsOf: left?.asOf ? new Date(left.asOf) : null,
  };
}

/** One card that left the table: what it brought in against what it cost. */
export type RealizedRow = {
  transactionId: string;
  occurredAt: Date;
  /** sold or traded */
  how: "sold" | "traded";
  eventName: string;
  code: string;
  kind: ProductKind;
  name: string;
  setName: string;
  cardNumber: string;
  variant: string;
  badge: string;
  /** its share of the deal (a bundle is split by sticker price) */
  soldCents: number;
  costCents: number | null;
  gainCents: number | null;
  gainPct: number | null;
};

/** Realized gain or loss on cards sold or traded away. Voided deals are left out. */
export async function realizedGains(db: Db, opts: { eventId?: string | null } = {}): Promise<RealizedRow[]> {
  const voided = db
    .select({ id: transactions.voidsTransactionId })
    .from(transactions)
    .where(isNotNull(transactions.voidsTransactionId));

  const conds = [
    eq(transactionLines.direction, "out"),
    isNotNull(transactionLines.unitId),
    inArray(transactions.kind, ["sale", "trade"]),
    notInArray(transactions.id, sql`(${voided})`),
  ];
  if (opts.eventId !== undefined) {
    conds.push(opts.eventId === null ? sql`${transactions.eventId} is null` : eq(transactions.eventId, opts.eventId));
  }

  const rows = await db
    .select({
      transactionId: transactions.id,
      occurredAt: transactions.occurredAt,
      txKind: transactions.kind,
      eventName: events.name,
      code: units.code,
      kind: products.kind,
      name: products.name,
      setName: products.setName,
      cardNumber: products.cardNumber,
      variant: products.variant,
      condition: products.condition,
      grader: products.grader,
      grade: products.grade,
      soldCents: transactionLines.amountCents,
      costCents: transactionLines.costCents,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactions.id, transactionLines.transactionId))
    .innerJoin(units, eq(units.id, transactionLines.unitId))
    .innerJoin(products, eq(products.id, units.productId))
    .leftJoin(events, eq(events.id, transactions.eventId))
    .where(and(...conds))
    .orderBy(desc(transactions.occurredAt));

  return rows.map((r) => {
    const gain = r.costCents === null ? null : r.soldCents - r.costCents;
    return {
      transactionId: r.transactionId,
      occurredAt: r.occurredAt,
      how: r.txKind === "trade" ? "traded" : "sold",
      eventName: r.eventName ?? "",
      code: r.code,
      kind: r.kind as ProductKind,
      name: r.name,
      setName: r.setName,
      cardNumber: r.cardNumber,
      variant: r.variant,
      badge: badgeFor({ kind: r.kind as ProductKind, condition: r.condition, grader: r.grader, grade: r.grade }),
      soldCents: r.soldCents,
      costCents: r.costCents,
      gainCents: gain,
      gainPct: gain === null || r.costCents === null ? null : pct(gain, r.costCents),
    };
  });
}
