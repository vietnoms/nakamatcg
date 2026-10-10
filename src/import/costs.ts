/**
 * Cost matching: copies with no cost (scanned into a display portfolio) take what I paid from
 * the same card in my other Collectr portfolios. Pure: no database.
 */
import { productKey, type ImportRow } from "./collectr";

type Donor = { cost: number; used: boolean };

/** Copies of each card, with a cost, that other portfolios can lend. Each copy is lent once. */
export type CostBook = { exact: Map<string, Donor[]>; loose: Map<string, Donor[]> };

type KeyFields = Omit<ImportRow, "key" | "line" | "quantity" | "marketCents" | "costCents" | "notes" | "portfolio" | "kind">;

/** The card regardless of condition: a fresh scan is often NM where the original says LP. */
export const looseKey = (r: KeyFields) => productKey({ ...r, condition: "" });

export function costBook(rows: ImportRow[]): CostBook {
  const book: CostBook = { exact: new Map(), loose: new Map() };
  for (const r of rows) {
    if (r.costCents === null) continue;
    const loose = looseKey(r);
    for (let i = 0; i < r.quantity; i++) {
      const d = { cost: r.costCents, used: false };
      book.exact.set(r.key, [...(book.exact.get(r.key) ?? []), d]);
      book.loose.set(loose, [...(book.loose.get(loose) ?? []), d]);
    }
  }
  return book;
}

/** A cost for one copy of a card: the same card in the same condition first, then any condition. */
export function takeCost(book: CostBook, key: string, loose: string): number | null {
  const d = book.exact.get(key)?.find((x) => !x.used) ?? book.loose.get(loose)?.find((x) => !x.used);
  if (!d) return null;
  d.used = true;
  return d.cost;
}
