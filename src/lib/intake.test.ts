import { describe, expect, it } from "vitest";
import { placeholderProduct, splitPile } from "./intake";

describe("quick intake", () => {
  it("splits a pile's total over every copy, adding up exactly", () => {
    const pile = splitPile({ raw: 14, slab: 1, sealed: 0 }, 8500);
    expect(pile.map((p) => [p.kind, p.costs.length])).toEqual([
      ["raw", 14],
      ["slab", 1],
    ]);
    expect(pile.flatMap((p) => p.costs).reduce((a, b) => a + b, 0)).toBe(8500);
    expect(Math.max(...pile.flatMap((p) => p.costs)) - Math.min(...pile.flatMap((p) => p.costs))).toBeLessThanOrEqual(1);
    expect(splitPile({ raw: 0, slab: 0, sealed: 0 }, 500)).toEqual([]);
  });

  it("names a placeholder by its kind unless a hint is given", () => {
    expect(placeholderProduct("slab").name).toBe("Unidentified slab");
    expect(placeholderProduct("raw", " Charizard? ").name).toBe("Charizard?");
  });
});
