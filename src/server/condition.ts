import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { priceHistory, products, units } from "@/db/schema";
import { productKey } from "@/import/collectr";
import { marketForCondition, type Condition } from "@/lib/condition";
import { suggestPrice } from "@/lib/pricing";
import { forSale, inGroup, type GroupFilter } from "./groups";
import { getSettings } from "./settings";

/** Which in-stock copies to change: ticked ones, or every copy of a card on sale (in one group, if given). */
export type ConditionTarget = { unitIds: string[] } | { productId: string; group?: GroupFilter };

/** what the last card changed came out at: its product in the new condition, market price, and whether that is an estimate */
export type ConditionChange = { moved: number; productId: string | null; marketCents: number | null; estimated: boolean };

type Product = typeof products.$inferSelect;

const keyOf = (p: Product, condition: string) =>
  productKey({
    game: p.game,
    name: p.name,
    setName: p.setName,
    cardNumber: p.cardNumber,
    variant: p.variant,
    rarity: p.rarity,
    condition,
    grader: p.grader,
    grade: p.grade,
    cert: p.cert,
    language: p.language,
  });

/**
 * Changes the condition of raw in-stock copies. Condition is part of a card's identity (as in
 * Collectr), so each copy moves to the same card in the new condition, made if it does not exist.
 * Its market price is the one already known for that condition (a Collectr import); failing that,
 * an estimate from Near Mint by the Settings percentages, recorded in price history as "condition".
 * Each copy is re-priced to the new suggested price and, if it has a sticker, queued for reprint.
 * The product a copy was imported as is kept, so a Collectr re-import does not add it again.
 */
export async function changeCondition(db: Db, target: ConditionTarget, to: Condition): Promise<ConditionChange> {
  const { pricing: rule, conditionPercents: pct } = await getSettings(db);
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const which =
      "unitIds" in target
        ? target.unitIds.length
          ? inArray(units.id, target.unitIds)
          : sql`false`
        : and(eq(units.productId, target.productId), forSale, inGroup(target.group));
    const rows = await tx
      .select({ unitId: units.id, product: products })
      .from(units)
      .innerJoin(products, eq(products.id, units.productId))
      .where(and(which, eq(units.status, "in_stock"), eq(products.kind, "raw"), sql`${products.condition} <> ${to}`));

    const bySource = new Map<string, { product: Product; unitIds: string[] }>();
    for (const r of rows) {
      const g = bySource.get(r.product.id) ?? { product: r.product, unitIds: [] };
      g.unitIds.push(r.unitId);
      bySource.set(r.product.id, g);
    }

    let last: ConditionChange = { moved: 0, productId: null, marketCents: null, estimated: false };
    for (const { product: p, unitIds } of bySource.values()) {
      const find = async (key: string) => (await tx.select().from(products).where(eq(products.naturalKey, key)).limit(1))[0];
      let dest = await find(keyOf(p, to));
      let market = dest?.marketCents ?? null;
      let estimated = false;
      if (market === null) {
        // a real Near Mint price beats one scaled from a played condition
        const nm = p.condition === "NM" ? p : await find(keyOf(p, "NM"));
        market = nm?.marketCents != null ? marketForCondition(nm.marketCents, "NM", to, pct) : marketForCondition(p.marketCents, p.condition, to, pct);
        estimated = market !== null;
      }
      const stamp = market === null ? {} : { marketCents: market, marketUpdatedAt: sql`now()` };
      if (!dest) {
        const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = p;
        [dest] = await tx
          .insert(products)
          .values({ ...rest, condition: to, naturalKey: keyOf(p, to), marketCents: market, marketUpdatedAt: market === null ? null : sql`now()` })
          .returning();
      } else if (estimated) {
        await tx.update(products).set({ ...stamp, updatedAt: sql`now()` }).where(eq(products.id, dest.id));
      }
      if (estimated && market !== null) await tx.insert(priceHistory).values({ productId: dest!.id, marketCents: market, source: "condition" });

      const price = suggestPrice(market, rule);
      await tx
        .update(units)
        .set({
          productId: dest!.id,
          importedProductId: sql`coalesce(${units.importedProductId}, case when ${units.source} = 'import' then ${units.productId} end)`,
          priceCents: price,
          // the sticker shows the condition: reprint it even when the price comes out the same
          reprint: sql`${units.stickeredAt} is not null`,
          updatedAt: sql`now()`,
        })
        .where(inArray(units.id, unitIds));
      last = { moved: last.moved + unitIds.length, productId: dest!.id, marketCents: market, estimated };
    }
    return last;
  });
}
