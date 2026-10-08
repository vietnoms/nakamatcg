import { describe, expect, it } from "vitest";
import { allocate } from "./allocate";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("allocate", () => {
  it("splits a bundle price in proportion to sticker prices", () => {
    expect(allocate(9000, [5000, 3000, 2000])).toEqual([4500, 2700, 1800]);
  });

  it("always sums to the total exactly", () => {
    const cases: [number, number[]][] = [
      [1000, [333, 333, 334]],
      [100, [1, 1, 1]],
      [9999, [1234, 5678, 91, 2]],
      [1, [500, 500]],
      [12345, [1]],
    ];
    for (const [total, weights] of cases) {
      const out = allocate(total, weights);
      expect(sum(out)).toBe(total);
      expect(out.every((c) => Number.isInteger(c) && c >= 0)).toBe(true);
    }
  });

  it("gives leftover cents to the largest remainders, ties to the earliest", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [1, 2])).toEqual([3, 7]);
  });

  it("splits evenly when every weight is zero", () => {
    expect(allocate(100, [0, 0, 0])).toEqual([34, 33, 33]);
  });

  it("handles an empty list and a zero total", () => {
    expect(allocate(0, [])).toEqual([]);
    expect(allocate(0, [100, 200])).toEqual([0, 0]);
  });

  it("refuses negative or fractional input", () => {
    expect(() => allocate(-1, [1])).toThrow();
    expect(() => allocate(10.5, [1])).toThrow();
    expect(() => allocate(10, [-1, 2])).toThrow();
    expect(() => allocate(10, [])).toThrow();
  });
});
