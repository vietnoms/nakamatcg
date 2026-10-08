import { describe, expect, it } from "vitest";
import { DEFAULT_LABEL, batchZpl, labelZpl, testLabelZpl, wrap, zplText, type LabelData } from "./zpl";

const BASE = "https://cards.example.com";

const umbreon: LabelData = {
  code: "K7M2QX",
  priceCents: 12500,
  name: "Umbreon VMAX (Alternate Full Art)",
  detail: "Evolving Skies 215/203",
  badge: "PSA 10",
  pricedOn: "10/09",
};

describe("zplText", () => {
  it("folds accents and drops what the printer font or ZPL cannot take", () => {
    expect(zplText("Pokémon Flabébé")).toBe("Pokemon Flabebe");
    expect(zplText("ピカチュウ Pikachu")).toBe("Pikachu");
    expect(zplText("a^b~c")).toBe("abc");
    expect(zplText("  two   spaces ")).toBe("two spaces");
  });
});

describe("wrap", () => {
  it("wraps on words and truncates the last line", () => {
    expect(wrap("Umbreon VMAX Alternate Full Art", 14, 2)).toEqual(["Umbreon VMAX", "Alternate Ful."]);
    expect(wrap("Pikachu", 14, 2)).toEqual(["Pikachu"]);
    expect(wrap("", 14, 2)).toEqual([]);
  });

  it("cuts a single word longer than a line", () => {
    expect(wrap("Supercalifragilistic", 8, 2)).toEqual(["Superca."]);
  });
});

describe("labelZpl", () => {
  const zpl = labelZpl(umbreon, DEFAULT_LABEL, BASE);

  it("is one label sized 1.5 x 1 in at 203 dpi", () => {
    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl.endsWith("^XZ")).toBe(true);
    expect(zpl).toContain("^PW305");
    expect(zpl).toContain("^LL203");
    expect(zpl).toContain("^MTD");
  });

  it("encodes the uppercase sticker link in alphanumeric mode", () => {
    expect(zpl).toContain("^FDMM,AHTTPS://CARDS.EXAMPLE.COM/U/K7M2QX^FS");
  });

  it("prints the price, code, badge, and date", () => {
    expect(zpl).toContain("^FD$125^FS");
    expect(zpl).toContain("^FDK7M2QX^FS");
    expect(zpl).toContain("^FDPSA 10^FS");
    expect(zpl).toContain("^FD10/09^FS");
  });

  it("keeps every field inside the label", () => {
    for (const m of zpl.matchAll(/\^FO(\d+),(\d+)\^A0N,(\d+),\d+/g)) {
      const y = Number(m[2]);
      const h = Number(m[3]);
      expect(y + h).toBeLessThanOrEqual(203);
    }
  });

  it("scales to 300 dpi", () => {
    const z = labelZpl(umbreon, { ...DEFAULT_LABEL, dpi: 300 }, BASE);
    expect(z).toContain("^PW450");
    expect(z).toContain("^LL300");
    expect(z).toContain("^BQN,2,6");
  });

  it("matches the reviewed layout", () => {
    expect(zpl).toMatchSnapshot();
  });
});

describe("batchZpl", () => {
  it("concatenates one ^XA..^XZ block per label", () => {
    const z = batchZpl([umbreon, { ...umbreon, code: "AAAAAA" }], DEFAULT_LABEL, BASE);
    expect(z.match(/\^XA/g)).toHaveLength(2);
    expect(z.match(/\^XZ/g)).toHaveLength(2);
  });
});

describe("testLabelZpl", () => {
  it("draws a border and names the size", () => {
    const z = testLabelZpl(DEFAULT_LABEL, BASE);
    expect(z).toContain("^GB305,203,");
    expect(z).toContain("1.5 x 1 in");
  });
});
