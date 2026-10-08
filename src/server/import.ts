import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { imports, priceHistory, products, units } from "@/db/schema";
import type { ImportRow, ProductKind } from "@/import/collectr";
import { badgeFor } from "@/import/collectr";
import { newUnitCode } from "@/lib/codes";

/** One product in the file: its rows merged (the same card can appear in several portfolios). */
export type PlanRow = {
  key: string;
  kind: ProductKind;
  name: string;
  setName: string;
  cardNumber: string;
  badge: string;
  quantityInFile: number;
  alreadyImported: number;
  newUnits: number;
  oldMarketCents: number | null;
  newMarketCents: number | null;
  isNewProduct: boolean;
};

export type ImportPlan = {
  rows: PlanRow[];
  newProducts: number;
  priceChanges: number;
  newUnits: number;
};

type Merged = { first: ImportRow; quantity: number; marketCents: number | null; costs: (number | null)[] };

function merge(items: ImportRow[]): Map<string, Merged> {
  const byKey = new Map<string, Merged>();
  for (const it of items) {
    const m = byKey.get(it.key) ?? { first: it, quantity: 0, marketCents: null, costs: [] };
    m.quantity += it.quantity;
    if (it.marketCents !== null) m.marketCents = it.marketCents;
    for (let i = 0; i < it.quantity; i++) m.costs.push(it.costCents);
    byKey.set(it.key, m);
  }
  return byKey;
}

const CHUNK = 1000;
function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

async function existing(db: Db, keys: string[]) {
  const prods = new Map<string, { id: string; marketCents: number | null }>();
  for (const part of chunks(keys)) {
    const rows = await db
      .select({ id: products.id, key: products.naturalKey, marketCents: products.marketCents })
      .from(products)
      .where(inArray(products.naturalKey, part));
    for (const r of rows) prods.set(r.key, { id: r.id, marketCents: r.marketCents });
  }
  const imported = new Map<string, number>();
  const ids = [...prods.values()].map((p) => p.id);
  for (const part of chunks(ids)) {
    const rows = await db
      .select({ productId: units.productId, n: sql<number>`count(*)::int` })
      .from(units)
      .where(and(inArray(units.productId, part), eq(units.source, "import")))
      .groupBy(units.productId);
    for (const r of rows) imported.set(r.productId, r.n);
  }
  return { prods, imported };
}

/**
 * What applying would do. A product is matched by its natural key. Units are only ever added:
 * the file's quantity is compared with how many units were EVER imported for the product (sold
 * ones included), so a card sold at a show and still in Collectr is not imported again.
 */
export async function planImport(db: Db, items: ImportRow[]): Promise<ImportPlan> {
  const merged = merge(items);
  const { prods, imported } = await existing(db, [...merged.keys()]);
  const rows: PlanRow[] = [];
  for (const [key, m] of merged) {
    const p = prods.get(key);
    const already = p ? (imported.get(p.id) ?? 0) : 0;
    rows.push({
      key,
      kind: m.first.kind,
      name: m.first.name,
      setName: m.first.setName,
      cardNumber: m.first.cardNumber,
      badge: badgeFor(m.first),
      quantityInFile: m.quantity,
      alreadyImported: already,
      newUnits: Math.max(0, m.quantity - already),
      oldMarketCents: p?.marketCents ?? null,
      newMarketCents: m.marketCents,
      isNewProduct: !p,
    });
  }
  rows.sort((a, b) => a.setName.localeCompare(b.setName) || a.name.localeCompare(b.name));
  return {
    rows,
    newProducts: rows.filter((r) => r.isNewProduct).length,
    priceChanges: rows.filter((r) => !r.isNewProduct && r.newMarketCents !== null && r.newMarketCents !== r.oldMarketCents).length,
    newUnits: rows.reduce((n, r) => n + r.newUnits, 0),
  };
}

/** Codes that are not in use yet. Collisions are rare (30 bits) but checked, never assumed away. */
export async function freshCodes(db: Db, n: number): Promise<string[]> {
  const out = new Set<string>();
  while (out.size < n) {
    const want = new Set<string>();
    while (want.size < n - out.size) {
      const c = newUnitCode();
      if (!out.has(c)) want.add(c);
    }
    const taken = new Set<string>();
    for (const part of chunks([...want])) {
      const rows = await db.select({ code: units.code }).from(units).where(inArray(units.code, part));
      for (const r of rows) taken.add(r.code);
    }
    for (const c of want) if (!taken.has(c)) out.add(c);
  }
  return [...out];
}

export type ImportResult = { importId: string; newProducts: number; priceChanges: number; newUnits: number };

export async function applyImport(db: Db, items: ImportRow[], filename: string): Promise<ImportResult> {
  const plan = await planImport(db, items);
  const merged = merge(items);

  return db.transaction(async (tx) => {
    const [imp] = await tx
      .insert(imports)
      .values({
        filename,
        rowCount: items.length,
        summary: { newProducts: plan.newProducts, priceChanges: plan.priceChanges, newUnits: plan.newUnits },
      })
      .returning({ id: imports.id });
    if (!imp) throw new Error("import row not created");

    const ids = new Map<string, string>();
    const { prods } = await existing(tx as unknown as Db, [...merged.keys()]);
    for (const [key, p] of prods) ids.set(key, p.id);

    // new products
    const fresh = plan.rows.filter((r) => r.isNewProduct);
    for (const part of chunks(fresh)) {
      const rows = await tx
        .insert(products)
        .values(
          part.map((r) => {
            const f = merged.get(r.key)!.first;
            return {
              kind: f.kind,
              game: f.game,
              name: f.name,
              setName: f.setName,
              cardNumber: f.cardNumber,
              variant: f.variant,
              rarity: f.rarity,
              condition: f.condition,
              grader: f.grader,
              grade: f.grade,
              cert: f.cert,
              language: f.language,
              naturalKey: r.key,
              marketCents: r.newMarketCents,
              marketUpdatedAt: r.newMarketCents === null ? null : sql`now()`,
            };
          }),
        )
        .returning({ id: products.id, key: products.naturalKey });
      for (const r of rows) ids.set(r.key, r.id);
    }

    // market prices: update changed ones, and record every observed price
    const history: { productId: string; marketCents: number; source: string; importId: string }[] = [];
    for (const r of plan.rows) {
      if (r.newMarketCents === null) continue;
      const productId = ids.get(r.key)!;
      if (!r.isNewProduct && r.newMarketCents !== r.oldMarketCents) {
        await tx
          .update(products)
          .set({ marketCents: r.newMarketCents, marketUpdatedAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(products.id, productId));
      }
      history.push({ productId, marketCents: r.newMarketCents, source: "collectr", importId: imp.id });
    }
    for (const part of chunks(history)) await tx.insert(priceHistory).values(part);

    // new units, one per physical copy, each with the cost from its own CSV row
    const codes = await freshCodes(tx as unknown as Db, plan.newUnits);
    let c = 0;
    const newUnits: (typeof units.$inferInsert)[] = [];
    for (const r of plan.rows) {
      if (r.newUnits === 0) continue;
      const costs = merged.get(r.key)!.costs.slice(r.alreadyImported);
      for (let i = 0; i < r.newUnits; i++) {
        newUnits.push({
          code: codes[c++]!,
          productId: ids.get(r.key)!,
          costCents: costs[i] ?? null,
          source: "import",
          importId: imp.id,
        });
      }
    }
    for (const part of chunks(newUnits)) await tx.insert(units).values(part);

    return { importId: imp.id, newProducts: plan.newProducts, priceChanges: plan.priceChanges, newUnits: plan.newUnits };
  });
}
