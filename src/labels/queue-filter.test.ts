import { describe, expect, it } from "vitest";
import { NO_FILTER, matches, reasonOf, type QueueRow } from "./queue-filter";

const row = (o: Partial<QueueRow>): QueueRow => ({
  code: "ABC123",
  name: "Pikachu",
  setName: "Crown Zenith",
  cardNumber: "160/159",
  kind: "raw",
  groupId: null,
  priceCents: 1000,
  marketCents: 900,
  costCents: 400,
  stickeredPriceCents: null,
  ...o,
});

describe("sticker queue filter", () => {
  it("hides cards below a value, on price, market or cost", () => {
    expect(matches(row({ priceCents: 499 }), { ...NO_FILTER, min: 500 })).toBe(false);
    expect(matches(row({ priceCents: 500 }), { ...NO_FILTER, min: 500 })).toBe(true);
    expect(matches(row({}), { ...NO_FILTER, basis: "cost", min: 500 })).toBe(false);
    expect(matches(row({}), { ...NO_FILTER, basis: "market", max: 899 })).toBe(false);
    // no cost known: hidden once a cost range is set, shown otherwise
    expect(matches(row({ costCents: null }), { ...NO_FILTER, basis: "cost", min: 0 })).toBe(false);
    expect(matches(row({ costCents: null }), NO_FILTER)).toBe(true);
  });

  it("filters by set, type, group and why it is in the queue", () => {
    expect(matches(row({}), { ...NO_FILTER, set: "Crown Zenith" })).toBe(true);
    expect(matches(row({}), { ...NO_FILTER, set: "151" })).toBe(false);
    expect(matches(row({ kind: "slab" }), { ...NO_FILTER, kind: "raw" })).toBe(false);
    expect(matches(row({}), { ...NO_FILTER, group: "none" })).toBe(true);
    expect(matches(row({ groupId: "g1" }), { ...NO_FILTER, group: "none" })).toBe(false);
    expect(reasonOf(row({ stickeredPriceCents: 800 }))).toBe("changed");
    expect(reasonOf(row({ stickeredPriceCents: 1000 }))).toBe("reprint");
    expect(matches(row({ stickeredPriceCents: 800 }), { ...NO_FILTER, reason: "new" })).toBe(false);
  });
});
