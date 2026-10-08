/**
 * Suggested sticker prices: market price times a percentage, rounded to a clean number by
 * price tier. Pure, shared by the pricing page, the re-sticker check, and the phone.
 */

export type RoundingMode = "nearest" | "up" | "down";

/** A tier applies to prices below `belowCents` (null: no upper bound). Tiers are sorted ascending. */
export type RoundingTier = { belowCents: number | null; stepCents: number };

export type PricingRule = {
  percent: number;
  mode: RoundingMode;
  tiers: RoundingTier[];
  minCents: number;
};

/** Whole dollars, rounded up (Viet, 2026-10-08: no $0.50 prices); $5 steps from $50. */
export const DEFAULT_PRICING: PricingRule = {
  percent: 100,
  mode: "up",
  tiers: [
    { belowCents: 5000, stepCents: 100 },
    { belowCents: null, stepCents: 500 },
  ],
  minCents: 100,
};

export type RestickThreshold = { percent: number; minCents: number };

export const DEFAULT_RESTICK: RestickThreshold = { percent: 10, minCents: 200 };

function stepFor(cents: number, tiers: RoundingTier[]): number {
  for (const t of tiers) if (t.belowCents === null || cents < t.belowCents) return t.stepCents;
  return tiers.at(-1)?.stepCents ?? 1;
}

export function roundPrice(cents: number, rule: PricingRule): number {
  const step = stepFor(cents, rule.tiers);
  const q = cents / step;
  const n = rule.mode === "up" ? Math.ceil(q) : rule.mode === "down" ? Math.floor(q) : Math.floor(q + 0.5);
  return Math.max(rule.minCents, n * step);
}

export function suggestPrice(marketCents: number | null, rule: PricingRule): number | null {
  if (marketCents === null) return null;
  return roundPrice(Math.round((marketCents * rule.percent) / 100), rule);
}

/** A sticker is stale when the suggestion moved by at least the percentage AND the dollar floor. */
export function needsRestick(
  stickerCents: number | null,
  suggestedCents: number | null,
  t: RestickThreshold,
): boolean {
  if (stickerCents === null || suggestedCents === null || stickerCents <= 0) return false;
  const diff = Math.abs(suggestedCents - stickerCents);
  return diff >= t.minCents && diff * 100 >= stickerCents * t.percent;
}

/** The range of the phone's offer slider for cards coming in (buys and trade-ins), in percent of market. */
export const OFFER_MIN_PERCENT = 60;
export const OFFER_MAX_PERCENT = 100;

export function clampOfferPercent(percent: number): number {
  if (!Number.isFinite(percent)) return OFFER_MIN_PERCENT;
  return Math.min(OFFER_MAX_PERCENT, Math.max(OFFER_MIN_PERCENT, Math.round(percent)));
}

/**
 * What to pay (or credit) for a card coming in: a percent of market, rounded down on the rule's
 * steps. Under $1 it keeps its cents instead of rounding to $0 (Viet, 2026-10-08): a stack of
 * cheap cards adds up to real money.
 */
export function offerPrice(marketCents: number, percent: number, rule: PricingRule): number {
  const exact = Math.round((marketCents * percent) / 100);
  if (exact < 100) return exact;
  return roundPrice(exact, { ...rule, mode: "down", minCents: 0 });
}
