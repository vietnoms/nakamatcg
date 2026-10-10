import "server-only";
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { imports, priceHistory, products, unitGroups, units } from "@/db/schema";
import type { ImportRow, ProductKind } from "@/import/collectr";
import { badgeFor } from "@/import/collectr";
import { costBook, looseKey, takeCost } from "@/import/costs";
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
  /** copies already here that move into this row's portfolio group (moveExisting) */
  moved: number;
};

export type ImportPlan = {
  rows: PlanRow[];
  newProducts: number;
  priceChanges: number;
  newUnits: number;
  /** own import: copies already here in no group, that this file's portfolios can group */
  ungrouped: number;
  /** copies with no cost that take one from the same card in a portfolio left out of the import */
  costsMatched: number;
  /** bought as a lot: what the new copies cost in all, and how many have no market price (so no cost) */
  lotCostCents: number | null;
  lotNoMarket: number;
  /** copies already here moved into their portfolio's group (moveExisting) */
  moved: number;
};

/**
 * Portfolios left out of an import can still lend what I paid: a display portfolio scanned in
 * Collectr has no costs, but the same cards sit in my main portfolio with theirs.
 */
export type ImportOptions = {
  costDonors?: ImportRow[];
  /** bought as a lot (someone's whole collection at 70% of market): every new copy costs this % of its market price */
  lotPercent?: number;
  /**
   * The file's portfolios list cards I already have here in other groups (a vending portfolio
   * scanned in Collectr): move those copies into the portfolio's group, keeping their cost, instead
   * of adding copies.
   */
  moveExisting?: boolean;
};

/**
 * Whose cards the file holds. own: mine, grouped by Collectr portfolio name. consignment: all of
 * them go into that consignor's group, with no cost (they are not mine), and are counted apart
 * from my own copies of the same card.
 */
export type ImportTarget = { kind: "own" } | { kind: "consignment"; groupId: string };

type Merged = { first: ImportRow; quantity: number; marketCents: number | null; costs: (number | null)[]; portfolios: string[] };

function merge(items: ImportRow[]): Map<string, Merged> {
  const byKey = new Map<string, Merged>();
  for (const it of items) {
    const m = byKey.get(it.key) ?? { first: it, quantity: 0, marketCents: null, costs: [], portfolios: [] };
    m.quantity += it.quantity;
    if (it.marketCents !== null) m.marketCents = it.marketCents;
    for (let i = 0; i < it.quantity; i++) {
      m.costs.push(it.costCents);
      m.portfolios.push(it.portfolio);
    }
    byKey.set(it.key, m);
  }
  return byKey;
}

/** The imported units a file is compared against: my own (no group or an own group), or one consignor's. */
function scope(target: ImportTarget): SQL {
  if (target.kind === "consignment") return eq(units.groupId, target.groupId);
  const consigned = sql`(select ${unitGroups.id} from ${unitGroups} where ${unitGroups.kind} = 'consignment')`;
  return or(isNull(units.groupId), sql`${units.groupId} not in ${consigned}`)!;
}

const CHUNK = 1000;
function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

async function existing(db: Db, keys: string[], target: ImportTarget) {
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
      .where(and(inArray(units.productId, part), eq(units.source, "import"), scope(target)))
      .groupBy(units.productId);
    for (const r of rows) imported.set(r.productId, r.n);
  }
  return { prods, imported };
}

type MovePlan = {
  moves: { unitId: string; key: string; portfolio: string; costIfMissing: number | null }[];
  /** per product key: the new copies still needed after moves, per portfolio */
  create: Map<string, { portfolio: string; n: number }[]>;
};

/**
 * For moveExisting: each portfolio in the file should hold as many copies of a card as it lists.
 * Copies already in its group count, sold ones too (so a card sold here is not brought back).
 * The shortfall is met by moving in-stock copies of the same card, in any condition (a fresh scan
 * is often NM where the original says LP), from my other groups or no group; never from another
 * portfolio being imported, a PC group or a consignor. Only what is still short becomes new copies,
 * and never more than the usual count (file quantity minus copies ever imported) allows.
 */
async function planMoves(db: Db, items: ImportRow[], merged: Map<string, Merged>, budget: Map<string, number>): Promise<MovePlan> {
  const out: MovePlan = { moves: [], create: new Map() };
  const want = new Map<string, Map<string, { q: number; keys: Map<string, number>; cost: number | null }>>();
  for (const it of items) {
    const p = it.portfolio.trim();
    const loose = looseKey(it);
    const byLoose = want.get(p) ?? new Map();
    const w = byLoose.get(loose) ?? { q: 0, keys: new Map<string, number>(), cost: null };
    w.q += it.quantity;
    w.keys.set(it.key, (w.keys.get(it.key) ?? 0) + it.quantity);
    w.cost ??= it.costCents;
    byLoose.set(loose, w);
    want.set(p, byLoose);
  }

  // every product that is the same card as one in the file, in any condition
  const names = [...new Set(items.map((i) => i.name))];
  const prods: { id: string; key: string; loose: string }[] = [];
  for (const part of chunks(names)) {
    const rows = await db.select().from(products).where(inArray(products.name, part));
    for (const r of rows) prods.push({ id: r.id, key: r.naturalKey, loose: looseKey(r) });
  }
  const prodOf = new Map(prods.map((p) => [p.id, p]));
  const looseWanted = new Set([...want.values()].flatMap((m) => [...m.keys()]));
  const ids = prods.filter((p) => looseWanted.has(p.loose)).map((p) => p.id);
  const copies: { id: string; productId: string; groupId: string | null; status: string; createdAt: Date; code: string }[] = [];
  for (const part of chunks(ids)) {
    copies.push(
      ...(await db
        .select({ id: units.id, productId: units.productId, groupId: units.groupId, status: units.status, createdAt: units.createdAt, code: units.code })
        .from(units)
        .where(inArray(units.productId, part))
        .orderBy(asc(units.createdAt), asc(units.code))),
    );
  }
  const groups = await db.select({ id: unitGroups.id, name: unitGroups.name, kind: unitGroups.kind }).from(unitGroups);
  const kindOf = new Map(groups.map((g) => [g.id, g.kind]));
  const groupOf = new Map(groups.filter((g) => g.kind === "own").map((g) => [g.name, g.id]));
  const importing = new Set([...want.keys()].map((p) => groupOf.get(p)).filter(Boolean));
  const taken = new Set<string>();
  const left = new Map(budget);

  for (const [p, byLoose] of want) {
    const g = groupOf.get(p);
    for (const [loose, w] of byLoose) {
      const here = copies.filter((c) => g !== undefined && c.groupId === g && c.status !== "removed" && prodOf.get(c.productId)?.loose === loose).length;
      let need = w.q - here;
      if (need <= 0) continue;
      const from = copies
        .filter(
          (c) =>
            !taken.has(c.id) &&
            c.status === "in_stock" &&
            prodOf.get(c.productId)?.loose === loose &&
            (c.groupId === null || (kindOf.get(c.groupId) === "own" && !importing.has(c.groupId))),
        )
        // the same condition first
        .sort((a, b) => Number(!w.keys.has(prodOf.get(a.productId)!.key)) - Number(!w.keys.has(prodOf.get(b.productId)!.key)));
      for (const c of from.slice(0, need)) {
        taken.add(c.id);
        const key = prodOf.get(c.productId)!.key;
        out.moves.push({ unitId: c.id, key: w.keys.has(key) ? key : [...w.keys.keys()][0]!, portfolio: p, costIfMissing: w.cost });
        need--;
      }
      // what is still short: new copies, within each key's usual count
      for (const [key, qty] of w.keys) {
        if (need <= 0) break;
        const n = Math.min(need, qty, left.get(key) ?? 0);
        if (n <= 0) continue;
        left.set(key, (left.get(key) ?? 0) - n);
        out.create.set(key, [...(out.create.get(key) ?? []), { portfolio: p, n }]);
        need -= n;
      }
    }
  }
  return out;
}

type CostMatch = {
  /** per product key: the costs of its new copies, in file order, gaps filled where a donor had one */
  forNew: Map<string, (number | null)[]>;
  /** copies already here (in this file's portfolios' groups, in stock) with no cost, and the cost they take */
  existing: { id: string; costCents: number }[];
  matched: number;
};

async function matchCosts(
  db: Db,
  merged: Map<string, Merged>,
  rows: { key: string; alreadyImported: number; newUnits: number }[],
  prods: Map<string, { id: string }>,
  target: ImportTarget,
  donors: ImportRow[],
  lotPercent?: number,
): Promise<CostMatch> {
  const out: CostMatch = { forNew: new Map(), existing: [], matched: 0 };
  for (const r of rows) {
    const m = merged.get(r.key)!;
    // a lot's price replaces the seller's costs in the file: what they paid is not what I paid
    const lot = lotPercent === undefined || m.marketCents === null ? null : Math.round((m.marketCents * lotPercent) / 100);
    out.forNew.set(r.key, lotPercent !== undefined ? Array<number | null>(r.newUnits).fill(lot) : m.costs.slice(r.alreadyImported, r.alreadyImported + r.newUnits));
  }
  if (target.kind !== "own" || donors.length === 0) return out;
  const book = costBook(donors);
  const loose = (key: string) => looseKey(merged.get(key)!.first);

  // copies imported earlier first: they were scanned first
  const names = [...new Set([...merged.values()].flatMap((m) => m.portfolios).map((n) => n.trim()).filter(Boolean))];
  const keyOf = new Map([...prods].map(([key, p]) => [p.id, key]));
  if (names.length && keyOf.size) {
    const groups = db.select({ id: unitGroups.id }).from(unitGroups).where(and(inArray(unitGroups.name, names), eq(unitGroups.kind, "own")));
    for (const part of chunks([...keyOf.keys()])) {
      const bare = await db
        .select({ id: units.id, productId: units.productId })
        .from(units)
        .where(and(inArray(units.productId, part), isNull(units.costCents), eq(units.status, "in_stock"), inArray(units.groupId, groups)))
        .orderBy(asc(units.createdAt), asc(units.code));
      for (const u of bare) {
        const key = keyOf.get(u.productId)!;
        const cost = takeCost(book, key, loose(key));
        if (cost !== null) out.existing.push({ id: u.id, costCents: cost });
      }
    }
  }
  for (const [key, costs] of out.forNew) {
    out.forNew.set(
      key,
      costs.map((c) => (c !== null ? c : takeCost(book, key, loose(key)))),
    );
    out.matched += costs.filter((c, i) => c === null && out.forNew.get(key)![i] !== null).length;
  }
  out.matched += out.existing.length;
  return out;
}

/**
 * What applying would do. A product is matched by its natural key. Units are only ever added:
 * the file's quantity is compared with how many units were EVER imported for the product (sold
 * ones included), so a card sold at a show and still in Collectr is not imported again.
 */
export async function planImport(db: Db, items: ImportRow[], target: ImportTarget = { kind: "own" }, opts: ImportOptions = {}): Promise<ImportPlan> {
  const merged = merge(items);
  const { prods, imported } = await existing(db, [...merged.keys()], target);
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
      moved: 0,
    });
  }
  const moving = target.kind === "own" && opts.moveExisting === true;
  if (moving) {
    const mv = await planMoves(db, items, merged, new Map(rows.map((r) => [r.key, r.newUnits])));
    for (const r of rows) {
      r.newUnits = (mv.create.get(r.key) ?? []).reduce((n, c) => n + c.n, 0);
      r.moved = mv.moves.filter((m) => m.key === r.key).length;
    }
  }
  rows.sort((a, b) => a.setName.localeCompare(b.setName) || a.name.localeCompare(b.name));
  let ungrouped = 0;
  const hasPortfolios = items.some((i) => i.portfolio.trim());
  const known = [...prods.values()].map((p) => p.id);
  // moving takes copies in no group into their portfolio's group anyway
  if (target.kind === "own" && hasPortfolios && known.length && !moving) {
    for (const part of chunks(known)) {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(units)
        .where(and(inArray(units.productId, part), eq(units.source, "import"), isNull(units.groupId)));
      ungrouped += r?.n ?? 0;
    }
  }
  const lot = target.kind === "own" ? opts.lotPercent : undefined;
  const costs = await matchCosts(db, merged, rows, prods, target, opts.costDonors ?? [], lot);
  const lotCosts = [...costs.forNew.values()].flat();
  return {
    ungrouped,
    costsMatched: costs.matched,
    lotCostCents: lot === undefined ? null : lotCosts.reduce<number>((n, c) => n + (c ?? 0), 0),
    lotNoMarket: lot === undefined ? 0 : lotCosts.filter((c) => c === null).length,
    rows,
    newProducts: rows.filter((r) => r.isNewProduct).length,
    priceChanges: rows.filter((r) => !r.isNewProduct && r.newMarketCents !== null && r.newMarketCents !== r.oldMarketCents).length,
    newUnits: rows.reduce((n, r) => n + r.newUnits, 0),
    moved: rows.reduce((n, r) => n + r.moved, 0),
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

export type ImportResult = {
  importId: string;
  newProducts: number;
  priceChanges: number;
  newUnits: number;
  /** groups made from portfolio names seen for the first time */
  newGroups: number;
  /** copies imported before groups existed that were put in their portfolio's group */
  grouped: number;
  costsMatched: number;
  moved: number;
};

/** My group (own or PC) for each portfolio name, made when missing. A name taken by a consignor gets no group. */
async function portfolioGroups(db: Db, names: string[]): Promise<{ ids: Map<string, string>; created: number }> {
  const ids = new Map<string, string>();
  const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (wanted.length === 0) return { ids, created: 0 };
  const found = await db.select().from(unitGroups).where(inArray(unitGroups.name, wanted));
  for (const g of found) if (g.kind !== "consignment") ids.set(g.name, g.id);
  const missing = wanted.filter((n) => !found.some((g) => g.name === n));
  if (missing.length) {
    const made = await db
      .insert(unitGroups)
      .values(missing.map((name) => ({ name, kind: "own" })))
      .returning({ id: unitGroups.id, name: unitGroups.name });
    for (const g of made) ids.set(g.name, g.id);
  }
  return { ids, created: missing.length };
}

export async function applyImport(
  db: Db,
  items: ImportRow[],
  filename: string,
  target: ImportTarget = { kind: "own" },
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const plan = await planImport(db, items, target, opts);
  const merged = merge(items);

  return db.transaction(async (tx) => {
    const [imp] = await tx
      .insert(imports)
      .values({
        filename,
        rowCount: items.length,
        summary: {
          newProducts: plan.newProducts,
          priceChanges: plan.priceChanges,
          newUnits: plan.newUnits,
          costsMatched: plan.costsMatched,
          moved: plan.moved,
          lotPercent: opts.lotPercent ?? null,
          lotCostCents: plan.lotCostCents,
        },
      })
      .returning({ id: imports.id });
    if (!imp) throw new Error("import row not created");

    const ids = new Map<string, string>();
    const { prods } = await existing(tx as unknown as Db, [...merged.keys()], target);
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

    // groups: a consignor's file goes into their group; mine go into one group per portfolio
    const groups =
      target.kind === "own"
        ? await portfolioGroups(tx as unknown as Db, [...merged.values()].flatMap((m) => m.portfolios))
        : { ids: new Map<string, string>(), created: 0 };
    const groupFor = (portfolio: string | undefined) =>
      target.kind === "consignment" ? target.groupId : (groups.ids.get((portfolio ?? "").trim()) ?? null);

    // copies I already have, moved into the portfolio's group they were scanned into; they keep their cost
    const moving = target.kind === "own" && opts.moveExisting === true;
    const mv = moving ? await planMoves(tx as unknown as Db, items, merged, new Map(plan.rows.map((r) => [r.key, r.newUnits]))) : null;
    for (const m of mv?.moves ?? []) {
      await tx
        .update(units)
        .set({ groupId: groupFor(m.portfolio), costCents: sql`coalesce(${units.costCents}, ${m.costIfMissing})`, updatedAt: sql`now()` })
        .where(eq(units.id, m.unitId));
    }

    // costs lent by the portfolios left out: for copies already here, then for the new ones
    const lent = await matchCosts(tx as unknown as Db, merged, plan.rows, prods, target, opts.costDonors ?? [], target.kind === "own" ? opts.lotPercent : undefined);
    for (const e of lent.existing) await tx.update(units).set({ costCents: e.costCents, updatedAt: sql`now()` }).where(eq(units.id, e.id));

    // new units, one per physical copy, each with the cost and group from its own CSV row
    const codes = await freshCodes(tx as unknown as Db, plan.newUnits);
    let c = 0;
    const newUnits: (typeof units.$inferInsert)[] = [];
    for (const r of plan.rows) {
      if (r.newUnits === 0) continue;
      const m = merged.get(r.key)!;
      const costs = lent.forNew.get(r.key)!;
      // moving: new copies go to the portfolios still short of the card
      const portfolios = mv ? (mv.create.get(r.key) ?? []).flatMap((x) => Array<string>(x.n).fill(x.portfolio)) : m.portfolios.slice(r.alreadyImported);
      for (let i = 0; i < r.newUnits; i++) {
        newUnits.push({
          code: codes[c++]!,
          productId: ids.get(r.key)!,
          // a consignor's price paid is not my cost
          costCents: target.kind === "consignment" ? null : (costs[i] ?? null),
          source: "import",
          importId: imp.id,
          groupId: groupFor(portfolios[i]),
        });
      }
    }
    for (const part of chunks(newUnits)) await tx.insert(units).values(part);

    // copies imported before groups existed: give them their portfolio's group, oldest first
    let grouped = 0;
    if (target.kind === "own" && groups.ids.size > 0 && !moving) {
      for (const r of plan.rows) {
        if (r.alreadyImported === 0) continue;
        const m = merged.get(r.key)!;
        const loose = await tx
          .select({ id: units.id })
          .from(units)
          .where(and(eq(units.productId, ids.get(r.key)!), eq(units.source, "import"), isNull(units.groupId)))
          .orderBy(asc(units.createdAt), asc(units.code));
        // the earliest copies in the file are the ones imported earlier
        const already = m.portfolios.slice(0, r.alreadyImported);
        for (let i = 0; i < loose.length && i < already.length; i++) {
          const g = groupFor(already[i]);
          if (!g) continue;
          await tx.update(units).set({ groupId: g, updatedAt: sql`now()` }).where(eq(units.id, loose[i]!.id));
          grouped++;
        }
      }
    }

    return {
      importId: imp.id,
      newProducts: plan.newProducts,
      priceChanges: plan.priceChanges,
      newUnits: plan.newUnits,
      newGroups: groups.created,
      grouped,
      costsMatched: lent.matched,
      moved: mv?.moves.length ?? 0,
    };
  });
}
