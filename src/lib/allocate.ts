/**
 * Splits a total (cents) across lines in proportion to their weights (usually sticker
 * prices), by largest remainder, so the parts are whole cents and sum to the total exactly.
 * Used for bundle sales and for trade values, so profit per card stays right.
 */
export function allocate(totalCents: number, weights: number[]): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error("total must be a non-negative integer");
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) throw new Error("weights must be non-negative integers");
  if (weights.length === 0) {
    if (totalCents === 0) return [];
    throw new Error("cannot allocate a total across no lines");
  }

  const w = weights.every((x) => x === 0) ? weights.map(() => 1) : weights;
  const weightSum = w.reduce((a, b) => a + b, 0);

  const base = w.map((x) => Math.floor((totalCents * x) / weightSum));
  // remainder numerators, compared as integers to avoid float ties
  const rem = w.map((x, i) => totalCents * x - (base[i] ?? 0) * weightSum);
  let left = totalCents - base.reduce((a, b) => a + b, 0);

  const order = w.map((_, i) => i).sort((a, b) => (rem[b] ?? 0) - (rem[a] ?? 0) || a - b);
  for (const i of order) {
    if (left <= 0) break;
    base[i] = (base[i] ?? 0) + 1;
    left--;
  }
  return base;
}
