import { describe, expect, it } from "vitest";
import { bpsToPercent, consignmentFee, consignmentTotals, percentToBps } from "./consignment";

const terms = { feeBps: 1500, minFeeCents: 0 };

describe("consignmentFee", () => {
  it("takes the percentage of what the card sold for, rounded to the cent", () => {
    expect(consignmentFee(10000, terms)).toBe(1500);
    expect(consignmentFee(333, terms)).toBe(50);
    expect(consignmentFee(1, terms)).toBe(0);
  });

  it("never takes less than the minimum per card, nor more than the sale", () => {
    expect(consignmentFee(1000, { feeBps: 1000, minFeeCents: 200 })).toBe(200);
    expect(consignmentFee(150, { feeBps: 1000, minFeeCents: 200 })).toBe(150);
    expect(consignmentFee(0, { feeBps: 1000, minFeeCents: 200 })).toBe(0);
  });
});

describe("consignmentTotals", () => {
  it("adds up sales, my fee, and what I owe", () => {
    expect(consignmentTotals([10000, 2500, 333], terms)).toEqual({ cards: 3, soldCents: 12833, feeCents: 1500 + 375 + 50, payoutCents: 12833 - 1925 });
    expect(consignmentTotals([], terms)).toEqual({ cards: 0, soldCents: 0, feeCents: 0, payoutCents: 0 });
  });
});

describe("percent and basis points", () => {
  it("round-trips", () => {
    expect(percentToBps(15)).toBe(1500);
    expect(percentToBps(12.5)).toBe(1250);
    expect(bpsToPercent(1250)).toBe(12.5);
  });
});
