import "server-only";
import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { catalogItems, catalogSyncs } from "@/db/schema";
import { normalizeNumber, type CardRead, type CatalogCandidate, type Game } from "@/lookup/match";

const BASE = "https://tcgcsv.com/tcgplayer";
/** TCGplayer category ids on tcgcsv.com */
export const CATEGORIES: { id: number; game: Game }[] = [
  { id: 3, game: "pokemon" },
  { id: 68, game: "one_piece" },
];

type TcgGroup = { groupId: number; name: string };
type TcgProduct = {
  productId: number;
  name: string;
  cleanName: string;
  imageUrl: string;
  groupId: number;
  extendedData?: { name: string; value: string }[];
};
type TcgPrice = { productId: number; subTypeName: string; marketPrice: number | null; lowPrice: number | null };

export type Fetcher = (url: string) => Promise<unknown>;

/** tcgcsv.com asks for an identifiable User-Agent. */
const defaultFetch: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": "nakamatcg/0.1 (card show inventory; cards.vietnoms.com)" } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
};

const results = <T>(json: unknown): T[] => ((json as { results?: T[] })?.results ?? []) as T[];
const cents = (d: number | null | undefined) => (typeof d === "number" && Number.isFinite(d) ? Math.round(d * 100) : null);
const ext = (p: TcgProduct, key: string) => p.extendedData?.find((e) => e.name.toLowerCase() === key)?.value ?? "";

/** Runs `fn` over items with at most `n` in flight. */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

/**
 * Pulls every Pokemon and One Piece set from tcgcsv.com and upserts one row per product and
 * printing. About 300 sets; a few at a time to be polite. Records the run in catalog_syncs.
 */
export async function syncCatalog(db: Db, fetchJson: Fetcher = defaultFetch, opts: { concurrency?: number } = {}): Promise<{ items: number; sets: number }> {
  const [run] = await db.insert(catalogSyncs).values({}).returning({ id: catalogSyncs.id });
  let items = 0;
  let sets = 0;
  try {
    for (const cat of CATEGORIES) {
      const groups = results<TcgGroup>(await fetchJson(`${BASE}/${cat.id}/groups`));
      await pool(groups, opts.concurrency ?? 4, async (g) => {
        const [products, prices] = await Promise.all([
          fetchJson(`${BASE}/${cat.id}/${g.groupId}/products`).then((j) => results<TcgProduct>(j)),
          fetchJson(`${BASE}/${cat.id}/${g.groupId}/prices`).then((j) => results<TcgPrice>(j)),
        ]);
        const byProduct = new Map<number, TcgPrice[]>();
        for (const p of prices) byProduct.set(p.productId, [...(byProduct.get(p.productId) ?? []), p]);

        const rows: (typeof catalogItems.$inferInsert)[] = [];
        for (const p of products) {
          const number = ext(p, "number");
          const base = {
            productId: p.productId,
            game: cat.game,
            groupId: g.groupId,
            setName: g.name,
            name: p.name,
            cleanName: p.cleanName || p.name,
            number,
            numberKey: normalizeNumber(number),
            rarity: ext(p, "rarity"),
            imageUrl: p.imageUrl ?? "",
            updatedAt: new Date(),
          };
          const ps = byProduct.get(p.productId) ?? [];
          if (ps.length === 0) rows.push({ ...base, subType: "", marketCents: null, lowCents: null });
          for (const pr of ps) rows.push({ ...base, subType: pr.subTypeName ?? "", marketCents: cents(pr.marketPrice), lowCents: cents(pr.lowPrice) });
        }
        for (let i = 0; i < rows.length; i += 500) {
          await db
            .insert(catalogItems)
            .values(rows.slice(i, i + 500))
            .onConflictDoUpdate({
              target: [catalogItems.productId, catalogItems.subType],
              set: {
                game: sql`excluded.game`,
                groupId: sql`excluded.group_id`,
                setName: sql`excluded.set_name`,
                name: sql`excluded.name`,
                cleanName: sql`excluded.clean_name`,
                number: sql`excluded.number`,
                numberKey: sql`excluded.number_key`,
                rarity: sql`excluded.rarity`,
                imageUrl: sql`excluded.image_url`,
                marketCents: sql`excluded.market_cents`,
                lowCents: sql`excluded.low_cents`,
                updatedAt: sql`excluded.updated_at`,
              },
            });
        }
        items += rows.length;
        sets++;
      });
    }
    await db.update(catalogSyncs).set({ finishedAt: sql`now()`, items }).where(eq(catalogSyncs.id, run!.id));
    return { items, sets };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(catalogSyncs).set({ finishedAt: sql`now()`, items, error: msg.slice(0, 500) }).where(eq(catalogSyncs.id, run!.id));
    throw e;
  }
}

export async function catalogStatus(db: Db) {
  const [last] = await db.select().from(catalogSyncs).orderBy(desc(catalogSyncs.startedAt)).limit(1);
  const [lastOk] = await db
    .select()
    .from(catalogSyncs)
    .where(and(isNotNull(catalogSyncs.finishedAt), sql`${catalogSyncs.error} is null`))
    .orderBy(desc(catalogSyncs.startedAt))
    .limit(1);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(catalogItems);
  return { last: last ?? null, lastOk: lastOk ?? null, items: count?.n ?? 0 };
}

type Row = typeof catalogItems.$inferSelect;

/** Folds printing rows into one candidate per product. */
function group(rows: Row[]): CatalogCandidate[] {
  const by = new Map<number, CatalogCandidate>();
  for (const r of rows) {
    const c =
      by.get(r.productId) ??
      ({ productId: r.productId, game: r.game, setName: r.setName, name: r.name, cleanName: r.cleanName, number: r.number, rarity: r.rarity, imageUrl: r.imageUrl, printings: [] } as CatalogCandidate);
    if (r.subType || r.marketCents !== null) c.printings.push({ subType: r.subType, marketCents: r.marketCents });
    by.set(r.productId, c);
  }
  return [...by.values()];
}

/** Catalog entries that could be the card a scan read: same number, or a name match. */
export async function candidatesFor(db: Db, read: CardRead): Promise<CatalogCandidate[]> {
  const conds = [];
  const key = normalizeNumber(read.number);
  if (key) conds.push(eq(catalogItems.numberKey, key));
  const nameWords = read.name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 3);
  if (nameWords.length) conds.push(and(...nameWords.map((w) => ilike(catalogItems.cleanName, `%${w}%`)))!);
  if (conds.length === 0) return [];
  const rows = await db
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.game, read.game), or(...conds)))
    .limit(400);
  return group(rows);
}

/** Typed search for the Buy and Trade screens: every word must appear in the name, set, or number. */
export async function searchCatalog(db: Db, q: string, game: Game | null, limit = 20): Promise<CatalogCandidate[]> {
  const ws = q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((w) => w.replace(/[%_]/g, ""));
  if (ws.length === 0) return [];
  const conds = ws.map((w) => or(ilike(catalogItems.cleanName, `%${w}%`), ilike(catalogItems.setName, `%${w}%`), ilike(catalogItems.number, `${w}%`))!);
  if (game) conds.push(eq(catalogItems.game, game));
  // words found in the card's own name first (a set called "Pikachu ..." should not win), then the
  // closest name (the bundle before the bundle case), then the priciest
  const inName = sql.join(
    ws.map((w) => sql`(${catalogItems.cleanName} ilike ${`%${w}%`} or ${catalogItems.number} ilike ${`${w}%`})::int`),
    sql` + `,
  );
  const ids = await db
    .select({ productId: catalogItems.productId })
    .from(catalogItems)
    .where(and(...conds))
    .groupBy(catalogItems.productId)
    .orderBy(sql`max(${inName}) desc`, sql`min(length(${catalogItems.cleanName}))`, sql`max(${catalogItems.marketCents}) desc nulls last`)
    .limit(limit);
  if (ids.length === 0) return [];
  const rows = await db.select().from(catalogItems).where(inArray(catalogItems.productId, ids.map((i) => i.productId)));
  const order = new Map(ids.map((i, n) => [i.productId, n]));
  return group(rows).sort((a, b) => (order.get(a.productId) ?? 0) - (order.get(b.productId) ?? 0));
}
