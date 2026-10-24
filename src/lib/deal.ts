/**
 * One deal from one cart: what goes out (stickered cards, sealed, items without a sticker), what
 * comes in (cards, slabs, sealed at the offer), and the money that settles the difference either
 * way. Pure, so the phone and the tests share it. The kind is derived from the cart, not chosen:
 * out only is a sale, in only a buy, both a trade; reports already read those three.
 */
import { allocate } from "./allocate";
import type { DealOp } from "./ops";

export type OutItem = { unitId: string; stickerCents: number | null; marketCents: number | null };
export type MiscItem = { description: string; amountCents: number };
export type InItem = DealOp["in"][number];
export type Pay = { method: string; amountCents: number };

/** What a card going out weighs when a bundle price is split: its sticker, else market, else $1. */
export const weightOf = (u: Pick<OutItem, "stickerCents" | "marketCents">) => u.stickerCents ?? u.marketCents ?? 100;

/** Sticker value of what goes out (market for unpriced cards) plus items without a sticker. */
export function outSticker(out: OutItem[], misc: MiscItem[]): number {
  return out.reduce((n, o) => n + (o.stickerCents ?? o.marketCents ?? 0), 0) + misc.reduce((n, m) => n + m.amountCents, 0);
}

export type Settlement = {
  /** what the out side is sold for in this deal */
  outCents: number;
  /** what the in side is bought for */
  inCents: number;
  /** money that changes hands: positive, they pay me; negative, I pay them */
  settleCents: number;
};

/**
 * The money. With no agreed amount, out is at sticker and in at the offer. An agreed amount (say
 * "they pay $40" where the difference was $43.50) moves the out side when there is one (a
 * discount, split over the cards like a bundle), and the in side when nothing goes out.
 * Returns null when the agreed amount cannot work (it would price a side below zero).
 */
export function settle(p: { out: OutItem[]; misc: MiscItem[]; inCents: number; agreedCents: number | null }): Settlement | null {
  const sticker = outSticker(p.out, p.misc);
  const hasOut = p.out.length + p.misc.length > 0;
  if (p.agreedCents === null) return { outCents: sticker, inCents: p.inCents, settleCents: sticker - p.inCents };
  if (hasOut) {
    const outCents = p.inCents + p.agreedCents;
    return outCents < 0 ? null : { outCents, inCents: p.inCents, settleCents: p.agreedCents };
  }
  const inCents = -p.agreedCents;
  return inCents < 0 ? null : { outCents: 0, inCents, settleCents: p.agreedCents };
}

export function kindOf(p: { out: unknown[]; misc: unknown[]; in: unknown[] }): DealOp["kind"] {
  const goesOut = p.out.length + p.misc.length > 0;
  if (goesOut && p.in.length > 0) return "trade";
  return goesOut ? "sale" : "buy";
}

/**
 * The deal op. Out lines get the out amount split by weight (misc lines keep their share); in
 * lines keep their own amounts unless the in side was moved, then they are split by those amounts.
 * Payments carry the settled amount in the right direction and must add up to it.
 */
export function buildDeal(p: {
  id: string;
  occurredAt: string;
  eventId: string | null;
  device: string;
  note?: string;
  out: OutItem[];
  misc: MiscItem[];
  in: InItem[];
  money: Settlement;
  payments: Pay[];
}): DealOp {
  const { money } = p;
  if (p.out.length + p.misc.length + p.in.length === 0) throw new Error("The cart is empty");
  const paid = p.payments.reduce((n, x) => n + x.amountCents, 0);
  if (paid !== Math.abs(money.settleCents)) throw new Error("The payments don't add up to the difference");

  const outParts = allocate(money.outCents, [...p.out.map(weightOf), ...p.misc.map((m) => m.amountCents)]);
  const inSum = p.in.reduce((n, l) => n + l.costCents, 0);
  const inParts = inSum === money.inCents ? p.in.map((l) => l.costCents) : allocate(money.inCents, p.in.map((l) => l.costCents));
  const direction = money.settleCents >= 0 ? ("in" as const) : ("out" as const);

  return {
    type: "deal",
    id: p.id,
    kind: kindOf(p),
    occurredAt: p.occurredAt,
    eventId: p.eventId,
    note: p.note ?? "",
    device: p.device,
    out: p.out.map((o, i) => ({ unitId: o.unitId, amountCents: outParts[i]!, stickerCents: o.stickerCents })),
    misc: p.misc.map((m, j) => ({ description: m.description, amountCents: outParts[p.out.length + j]! })),
    in: p.in.map((l, i) => ({ ...l, costCents: inParts[i]! })),
    payments: money.settleCents === 0 ? [] : p.payments.filter((x) => x.amountCents > 0).map((x) => ({ ...x, direction })),
  };
}
