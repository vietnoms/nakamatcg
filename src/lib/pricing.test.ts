import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING, needsRestick, roundPrice, suggestPrice, type PricingRule } from "./pricing";

describe("roundPrice with the default tiers", () => {
  const r = (c: number) => roundPrice(c, DEFAULT_PRICING);

  it("rounds under $50 up to the next whole dollar, never to $0.50", () => {
    expect(r(301)).toBe(400);
    expect(r(350)).toBe(400);
    expect(r(300)).toBe(300);
    expect(r(1201)).toBe(1300);
    expect(r(4999)).toBe(5000);
  });

  it("rounds $50 and up, up to the next $5", () => {
    expect(r(8240)).toBe(8500);
    expect(r(8000)).toBe(8000);
    expect(r(30800)).toBe(31000);
  });

  it("never suggests less than $1", () => {
    expect(r(12)).toBe(100);
    expect(DEFAULT_PRICING.minCents).toBe(100);
  });
});

describe("rounding modes", () => {
  const halves: PricingRule = {
    percent: 100,
    mode: "nearest",
    tiers: [
      { belowCents: 500, stepCents: 50 },
      { belowCents: 5000, stepCents: 100 },
      { belowCents: null, stepCents: 500 },
    ],
    minCents: 50,
  };

  it("nearest rounds either way within the tier step", () => {
    expect(roundPrice(312, halves)).toBe(300);
    expect(roundPrice(326, halves)).toBe(350);
    expect(roundPrice(1250, halves)).toBe(1300);
    expect(roundPrice(8240, halves)).toBe(8000);
  });

  it("up and down round within the tier step", () => {
    expect(roundPrice(1201, { ...halves, mode: "up" })).toBe(1300);
    expect(roundPrice(1299, { ...halves, mode: "down" })).toBe(1200);
    expect(roundPrice(1200, { ...halves, mode: "up" })).toBe(1200);
  });
});

describe("suggestPrice", () => {
  it("applies the percentage before rounding", () => {
    expect(suggestPrice(10000, { ...DEFAULT_PRICING, percent: 90 })).toBe(9000);
    expect(suggestPrice(1199, { ...DEFAULT_PRICING, percent: 110 })).toBe(1400);
  });

  it("has nothing to suggest without a market price", () => {
    expect(suggestPrice(null, DEFAULT_PRICING)).toBeNull();
  });
});

describe("needsRestick", () => {
  const t = { percent: 10, minCents: 200 };

  it("flags a move past both thresholds, up or down", () => {
    expect(needsRestick(10000, 11500, t)).toBe(true);
    expect(needsRestick(10000, 8500, t)).toBe(true);
  });

  it("ignores small percentage moves on expensive cards", () => {
    expect(needsRestick(10000, 10500, t)).toBe(false);
  });

  it("ignores big percentage moves worth under the dollar floor", () => {
    expect(needsRestick(300, 450, t)).toBe(false);
  });

  it("never flags a unit with no sticker price or no suggestion", () => {
    expect(needsRestick(null, 5000, t)).toBe(false);
    expect(needsRestick(5000, null, t)).toBe(false);
  });
});
