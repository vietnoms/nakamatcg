import { describe, expect, it } from "vitest";
import { formatCents, formatStickerPrice, parseDollars } from "./money";

describe("parseDollars", () => {
  it("reads the ways people and CSVs write money", () => {
    expect(parseDollars("12")).toBe(1200);
    expect(parseDollars("12.5")).toBe(1250);
    expect(parseDollars("$12.50")).toBe(1250);
    expect(parseDollars("$1,234.56")).toBe(123456);
    expect(parseDollars(" 0.99 ")).toBe(99);
    expect(parseDollars(".5")).toBe(50);
  });

  it("rounds sub-cent prices to the cent", () => {
    expect(parseDollars("3.456")).toBe(346);
    expect(parseDollars("0.005")).toBe(1);
  });

  it("returns null for blanks and junk", () => {
    expect(parseDollars("")).toBeNull();
    expect(parseDollars("-")).toBeNull();
    expect(parseDollars("N/A")).toBeNull();
    expect(parseDollars("12.3.4")).toBeNull();
  });

  it("allows negatives only when asked", () => {
    expect(parseDollars("-5")).toBeNull();
    expect(parseDollars("-5", { allowNegative: true })).toBe(-500);
  });
});

describe("formatCents", () => {
  it("formats with cents and thousands separators", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-250)).toBe("-$2.50");
  });
});

describe("formatStickerPrice", () => {
  it("drops .00 so the price prints bigger", () => {
    expect(formatStickerPrice(12500)).toBe("$125");
    expect(formatStickerPrice(450)).toBe("$4.50");
    expect(formatStickerPrice(125000)).toBe("$1,250");
  });
});
