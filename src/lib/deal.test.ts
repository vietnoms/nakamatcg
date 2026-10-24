import { describe, expect, it } from "vitest";
import { buildDeal, kindOf, settle, type InItem, type OutItem } from "./deal";
import { dealBalance } from "./ops";

const out = (sticker: number | null, market: number | null = null, unitId = crypto.randomUUID()): OutItem => ({ unitId, stickerCents: sticker, marketCents: market });
const inn = (cost: number): InItem => ({
  unitId: crypto.randomUUID(),
  code: "ABCDEF",
  product: { kind: "raw", name: "Pikachu", setName: "", cardNumber: "", variant: "", condition: "NM", grader: "", grade: "", cert: "", marketCents: null },
  costCents: cost,
  priceCents: null,
});
const base = { id: crypto.randomUUID(), occurredAt: new Date().toISOString(), eventId: null, device: "test" };

describe("settle", () => {
  it("defaults to sticker out and offer in, the difference either way", () => {
    expect(settle({ out: [out(5000), out(null, 1500)], misc: [{ description: "Bulk", amountCents: 500 }], inCents: 3000, agreedCents: null })).toEqual({
      outCents: 7000,
      inCents: 3000,
      settleCents: 4000,
    });
    expect(settle({ out: [out(1000)], misc: [], inCents: 3000, agreedCents: null })?.settleCents).toBe(-2000);
  });

  it("an agreed amount discounts the out side, or moves the in side when nothing goes out", () => {
    expect(settle({ out: [out(5000)], misc: [], inCents: 1350, agreedCents: 3500 })).toEqual({ outCents: 4850, inCents: 1350, settleCents: 3500 });
    // I pay $20 for a pile offered at $21.50
    expect(settle({ out: [], misc: [], inCents: 2150, agreedCents: -2000 })).toEqual({ outCents: 0, inCents: 2000, settleCents: -2000 });
    // can't pay them more than the trade-in is worth and still price the cards out above zero
    expect(settle({ out: [out(1000)], misc: [], inCents: 3000, agreedCents: -4000 })).toBeNull();
    expect(settle({ out: [], misc: [], inCents: 1000, agreedCents: 500 })).toBeNull();
  });
});

describe("buildDeal", () => {
  it("derives the kind from what is in the cart", () => {
    expect(kindOf({ out: [1], misc: [], in: [] })).toBe("sale");
    expect(kindOf({ out: [], misc: [1], in: [] })).toBe("sale");
    expect(kindOf({ out: [], misc: [], in: [1] })).toBe("buy");
    expect(kindOf({ out: [1], misc: [], in: [1] })).toBe("trade");
  });

  it("a trade where they pay the difference balances, split over the cards by sticker", () => {
    const items = [out(3000), out(1000)];
    const money = settle({ out: items, misc: [], inCents: 1500, agreedCents: 2000 })!;
    const op = buildDeal({ ...base, out: items, misc: [], in: [inn(1000), inn(500)], money, payments: [{ method: "cash", amountCents: 2000 }] });
    expect(op.kind).toBe("trade");
    expect(op.out.map((o) => o.amountCents)).toEqual([2625, 875]);
    expect(op.payments).toEqual([{ method: "cash", amountCents: 2000, direction: "in" }]);
    expect(dealBalance(op)).toBe(0);
  });

  it("a buy where I pay a rounded amount splits the in side, payment out", () => {
    const money = settle({ out: [], misc: [], inCents: 2150, agreedCents: -2000 })!;
    const op = buildDeal({ ...base, out: [], misc: [], in: [inn(1500), inn(650)], money, payments: [{ method: "cash", amountCents: 2000 }] });
    expect(op.kind).toBe("buy");
    expect(op.in.map((l) => l.costCents)).toEqual([1395, 605]);
    expect(op.payments[0]!.direction).toBe("out");
    expect(dealBalance(op)).toBe(0);
  });

  it("an even trade has no payments; payments that don't add up are refused", () => {
    const items = [out(1000)];
    const money = settle({ out: items, misc: [], inCents: 1000, agreedCents: null })!;
    expect(buildDeal({ ...base, out: items, misc: [], in: [inn(1000)], money, payments: [] }).payments).toEqual([]);
    const owed = settle({ out: items, misc: [], inCents: 0, agreedCents: null })!;
    expect(() => buildDeal({ ...base, out: items, misc: [], in: [], money: owed, payments: [{ method: "cash", amountCents: 900 }] })).toThrow(/add up/);
    expect(() => buildDeal({ ...base, out: [], misc: [], in: [], money: owed, payments: [] })).toThrow(/empty/);
  });
});
