/** Raw-card conditions and what each is worth as a share of Near Mint. Pure: shared by server and pages. */

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABEL: Record<Condition, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

/** Percent of the Near Mint market price, roughly where played copies sell on TCGplayer. Editable in Settings. */
export type ConditionPercents = Record<Condition, number>;
export const DEFAULT_CONDITION_PERCENTS: ConditionPercents = { NM: 100, LP: 85, MP: 70, HP: 50, DMG: 35 };

export const isCondition = (c: string): c is Condition => (CONDITIONS as readonly string[]).includes(c);

/**
 * The market price of a copy in `to` condition, from a market price known for `from`. A condition
 * the app does not know (blank, or something odd from Collectr) counts as Near Mint.
 */
export function marketForCondition(marketCents: number | null, from: string, to: string, pct: ConditionPercents): number | null {
  if (marketCents === null) return null;
  const f = isCondition(from) ? pct[from] : 100;
  const t = isCondition(to) ? pct[to] : 100;
  if (f <= 0) return null;
  return Math.round((marketCents * t) / f);
}
