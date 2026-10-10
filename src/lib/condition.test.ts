import { describe, expect, it } from "vitest";
import { DEFAULT_CONDITION_PERCENTS as P, marketForCondition } from "./condition";

describe("marketForCondition", () => {
  it("scales a Near Mint price down to a played condition", () => {
    expect(marketForCondition(10000, "NM", "LP", P)).toBe(8500);
    expect(marketForCondition(10000, "NM", "DMG", P)).toBe(3500);
  });

  it("goes through Near Mint between two played conditions", () => {
    // LP $85 is NM $100, so MP is $70
    expect(marketForCondition(8500, "LP", "MP", P)).toBe(7000);
    expect(marketForCondition(7000, "MP", "NM", P)).toBe(10000);
  });

  it("treats an unknown condition as Near Mint and keeps no price as no price", () => {
    expect(marketForCondition(10000, "", "HP", P)).toBe(5000);
    expect(marketForCondition(null, "NM", "LP", P)).toBeNull();
    expect(marketForCondition(1000, "NM", "LP", { ...P, NM: 0 })).toBeNull();
  });

  it("keeps cents on cheap cards", () => {
    expect(marketForCondition(25, "NM", "LP", P)).toBe(21);
  });
});
