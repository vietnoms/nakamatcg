import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING, needsRestick, roundPrice, suggestPrice, type PricingRule } from "./pricing";

describe("roundPrice with the default tiers", () => {
  const r = (c: number) => roundPrice(c, DEFAULT_PRICING);

  it("rounds under $5 to the nearest $0.50", () => {
    expect(r(312)).toBe(300);
    expect(r(326)).toBe(350);
    expect(r(475)).toBe(500);
  });

  it("rounds $5 to $50 to the nearest dollar", () => {
    expect(r(1249)).toBe(1200);
    expect(r(1250)).toBe(1300);
    expect(r(4999)).toBe(5000);
  });

  it("rounds $50 and up to the nearest $5", () => {
    expect(r(8240)).toBe(8000);
    expect(r(8250)).toBe(8500);
    expect(r(30800)).toBe(31000);
  });

  it("never suggests less than the minimum", () => {
    expect(r(10)).toBe(DEFAULT_PRICING.minCents);
  });
});

describe("rounding modes", () => {
  const up: PricingRule = { ...DEFAULT_PRICING, mode: "up" };
  const down: PricingRule = { ...DEFAULT_PRICING, mode: "down" };

  it("up and down round within the tier step", () => {
    expect(roundPrice(1201, up)).toBe(1300);
    expect(roundPrice(1299, down)).toBe(1200);
    expect(roundPrice(1200, up)).toBe(1200);
  });
});

describe("suggestPrice", () => {
  it("applies the percentage before rounding", () => {
    expect(suggestPrice(10000, { ...DEFAULT_PRICING, percent: 90 })).toBe(9000);
    expect(suggestPrice(1199, { ...DEFAULT_PRICING, percent: 110 })).toBe(1300);
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
