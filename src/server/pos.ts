import "server-only";
import { desc, eq, gt, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, products, units } from "@/db/schema";
import { badgeFor, type ProductKind } from "@/import/collectr";
import type { PosProduct, PosSnapshot, PosUnit, UnitStatus } from "@/pos/types";
import { getSettings } from "./settings";

/** A delta overlaps the previous snapshot by this much, so a change committed mid-snapshot is not missed. */
const OVERLAP = "10 seconds";

/**
 * Everything the phone needs to sell offline. Full: every in-stock unit plus anything changed in
 * the last week (so a recently sold sticker scans as "sold", not "unknown"). Delta: units and
 * products changed since `since`.
 */
export async function posSnapshot(db: Db, since: Date | null): Promise<PosSnapshot> {
  const res = (await db.execute(sql`select now() as now`)) as unknown as { rows: { now: Date | string }[] };
  const now = res.rows[0]!.now;
  const unitWhere = since
    ? gt(units.updatedAt, sql`${since.toISOString()}::timestamptz - interval '${sql.raw(OVERLAP)}'`)
    : or(eq(units.status, "in_stock"), gt(units.updatedAt, sql`now() - interval '7 days'`));

  const rows = await db
    .select({
      id: units.id,
      code: units.code,
      status: units.status,
      priceCents: units.priceCents,
      costCents: units.costCents,
      updatedAt: units.updatedAt,
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
    })
    .from(units)
    .innerJoin(products, eq(products.id, units.productId))
    .where(unitWhere);

  const prodRows = await db
    .select()
    .from(products)
    .where(since ? gt(products.updatedAt, sql`${since.toISOString()}::timestamptz - interval '${sql.raw(OVERLAP)}'`) : undefined);

  const [settings, eventRows] = await Promise.all([getSettings(db), db.select().from(events).orderBy(desc(events.startsOn)).limit(20)]);

  return {
    serverTime: new Date(now).toISOString(),
    full: since === null,
    units: rows.map(
      (r): PosUnit => ({
        id: r.id,
        code: r.code,
        status: r.status as UnitStatus,
        priceCents: r.priceCents,
        costCents: r.costCents,
        productId: r.productId,
        kind: r.kind as ProductKind,
        name: r.name,
        setName: r.setName,
        cardNumber: r.cardNumber,
        variant: r.variant,
        badge: badgeFor({ kind: r.kind as ProductKind, condition: r.condition, grader: r.grader, grade: r.grade }),
        marketCents: r.marketCents,
        updatedAt: r.updatedAt.toISOString(),
      }),
    ),
    products: prodRows.map(
      (p): PosProduct => ({
        id: p.id,
        kind: p.kind as ProductKind,
        name: p.name,
        setName: p.setName,
        cardNumber: p.cardNumber,
        variant: p.variant,
        condition: p.condition,
        grader: p.grader,
        grade: p.grade,
        marketCents: p.marketCents,
      }),
    ),
    settings: {
      paymentMethods: settings.paymentMethods,
      tradeInPercent: settings.tradeInPercent,
      pricing: settings.pricing,
      activeEventId: settings.activeEventId,
    },
    events: eventRows.map((e) => ({ id: e.id, name: e.name, startsOn: e.startsOn, endsOn: e.endsOn })),
  };
}
