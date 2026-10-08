import { describe, expect, it } from "vitest";
import { DEFAULT_LABEL, batchZpl, foldGeometry, labelFields, labelZpl, testLabelZpl, wrap, zplText, type LabelData } from "./zpl";

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

describe("fold layout", () => {
  const FOLD = { ...DEFAULT_LABEL, layout: "fold" as const };
  const { front, backX } = foldGeometry(FOLD, BASE);
  const fields = labelFields(umbreon, FOLD, BASE);

  it("splits 1.5 in into a half-inch front, an edge band, and the back", () => {
    expect(front).toBe(102);
    expect(backX).toBe(118);
  });

  it("shows only the price and the condition on the front", () => {
    const onFront = fields.filter((f) => f.kind !== "line" && f.x < front);
    expect(onFront.map((f) => (f.kind === "text" ? f.text : f.kind))).toEqual(["$125", "PSA 10"]);
  });

  it("puts the QR, code, date, name and set on the back", () => {
    const back = fields.filter((f) => f.x >= backX);
    expect(back.some((f) => f.kind === "qr")).toBe(true);
    const texts = back.flatMap((f) => (f.kind === "text" ? [f.text] : []));
    expect(texts).toEqual(expect.arrayContaining(["K7M2QX", "10/09", "$125", "Umbreon VMAX"]));
    expect(texts.some((t) => t.startsWith("Evolving Skies"))).toBe(true);
  });

  it("keeps every field inside the label", () => {
    for (const f of fields) {
      const right = f.kind === "qr" ? f.x + f.size : f.kind === "line" ? f.x + f.w : f.box ? f.x + f.box.width : f.x;
      const bottom = f.kind === "qr" ? f.y + f.size : f.kind === "line" ? f.y + f.h : f.y + f.font;
      expect(right).toBeLessThanOrEqual(305);
      expect(bottom).toBeLessThanOrEqual(203);
    }
  });

  it("keeps the same sticker link", () => {
    expect(labelZpl(umbreon, FOLD, BASE)).toContain("^FDMM,AHTTPS://CARDS.EXAMPLE.COM/U/K7M2QX^FS");
  });

  it("leaves the back room for the QR when the front is set too wide", () => {
    const g = foldGeometry({ ...FOLD, foldFrontIn: 1.4 }, BASE);
    const qr = labelFields(umbreon, { ...FOLD, foldFrontIn: 1.4 }, BASE).find((f) => f.kind === "qr")!;
    expect(g.front).toBeLessThan(305 - 100);
    expect(qr.kind === "qr" && qr.x + qr.size).toBeLessThanOrEqual(305);
  });

  it("matches the reviewed layout", () => {
    expect(labelZpl(umbreon, FOLD, BASE)).toMatchSnapshot();
  });

  it("marks the fold on the test sticker", () => {
    const z = testLabelZpl(FOLD, BASE);
    expect(z).toContain(`^FO${front},0^GB1,203,1^FS`);
  });
});

describe("saved sticker settings from before layouts", () => {
  it("read as the standard layout", async () => {
    const { parseSettings } = await import("@/lib/settings");
    const { layout: _l, foldFrontIn: _f, foldGapIn: _g, ...old } = DEFAULT_LABEL;
    const s = parseSettings({ label: { ...old, darkness: 5 } }).label;
    expect(s).toMatchObject({ darkness: 5, layout: "standard", foldFrontIn: 0.5, foldGapIn: 0.08 });
  });
});
