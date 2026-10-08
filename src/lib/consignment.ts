/**
 * Consignment: I sell someone else's cards and keep a fee. Pure, shared by the groups page and
 * its tests. The fee is a percentage of what each card sold for (its share of the deal, so a
 * bundle discount is shared), never less than the minimum per card and never more than the sale.
 */

export type ConsignmentTerms = { feeBps: number; minFeeCents: number };

/** 15 -> 1500 basis points; 12.5 -> 1250. */
export function percentToBps(pct: number): number {
  return Math.round(pct * 100);
}

export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/** My fee on one card that sold for `soldCents`. */
export function consignmentFee(soldCents: number, t: ConsignmentTerms): number {
  if (soldCents <= 0) return 0;
  const fee = Math.max(Math.round((soldCents * t.feeBps) / 10000), t.minFeeCents);
  return Math.min(fee, soldCents);
}

export type ConsignmentTotals = { cards: number; soldCents: number; feeCents: number; payoutCents: number };

/** Totals for a list of sold cards: what they brought in, what I keep, what I owe the consignor. */
export function consignmentTotals(sold: number[], t: ConsignmentTerms): ConsignmentTotals {
  let soldCents = 0;
  let feeCents = 0;
  for (const s of sold) {
    soldCents += s;
    feeCents += consignmentFee(s, t);
  }
  return { cards: sold.length, soldCents, feeCents, payoutCents: soldCents - feeCents };
}
