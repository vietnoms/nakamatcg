/** Filters for the sticker queue. Pure, so the Stickers page and its tests share it. */

export type QueueRow = {
  code: string;
  name: string;
  setName: string;
  cardNumber: string;
  kind: string;
  groupId: string | null;
  priceCents: number;
  marketCents: number | null;
  costCents: number | null;
  stickeredPriceCents: number | null;
};

/** what a value range is measured on: the sticker price, the market price, or what I paid */
export type ValueBasis = "price" | "market" | "cost";
export type Reason = "new" | "changed" | "reprint";

export type QueueFilter = {
  search: string;
  /** "" every group; "none" no group; else a group id */
  group: string;
  set: string;
  kind: string;
  reason: "" | Reason;
  basis: ValueBasis;
  /** cents, inclusive; null: no bound */
  min: number | null;
  max: number | null;
};

export const NO_FILTER: QueueFilter = { search: "", group: "", set: "", kind: "", reason: "", basis: "price", min: null, max: null };

export function reasonOf(r: Pick<QueueRow, "priceCents" | "stickeredPriceCents">): Reason {
  if (r.stickeredPriceCents === null) return "new";
  return r.stickeredPriceCents !== r.priceCents ? "changed" : "reprint";
}

export function valueOf(r: QueueRow, basis: ValueBasis): number | null {
  return basis === "price" ? r.priceCents : basis === "market" ? r.marketCents : r.costCents;
}

/** A row with no value on the chosen basis (no market price, no cost) is hidden once a range is set. */
export function matches(r: QueueRow, f: QueueFilter): boolean {
  if (f.group && (r.groupId ?? "none") !== f.group) return false;
  if (f.set && r.setName !== f.set) return false;
  if (f.kind && r.kind !== f.kind) return false;
  if (f.reason && reasonOf(r) !== f.reason) return false;
  if (f.min !== null || f.max !== null) {
    const v = valueOf(r, f.basis);
    if (v === null) return false;
    if (f.min !== null && v < f.min) return false;
    if (f.max !== null && v > f.max) return false;
  }
  const n = f.search.trim().toLowerCase();
  return !n || `${r.code} ${r.name} ${r.setName} ${r.cardNumber}`.toLowerCase().includes(n);
}

export const isFiltered = (f: QueueFilter) =>
  Boolean(f.search.trim() || f.group || f.set || f.kind || f.reason || f.min !== null || f.max !== null);
