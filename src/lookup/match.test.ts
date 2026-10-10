import { describe, expect, it } from "vitest";
import { GAMES, isGame, medianCents, normalizeNumber, numberTotal, pickPrinting, rankCandidates, tidyName, tidySet, type CardRead, type CatalogCandidate } from "./match";

const read = (o: Partial<CardRead>): CardRead => ({ game: "pokemon", name: "", setName: "", setCode: "", number: "", finish: "", graded: null, ...o });
const cand = (o: Partial<CatalogCandidate>): CatalogCandidate => ({
  productId: 1,
  game: "pokemon",
  setName: "",
  name: "",
  cleanName: "",
  number: "",
  rarity: "",
  imageUrl: "",
  printings: [{ subType: "Holofoil", marketCents: 1000 }],
  ...o,
});

describe("normalizeNumber", () => {
  it("keeps the part before the slash without leading zeros", () => {
    expect(normalizeNumber("025/165")).toBe("25");
    expect(normalizeNumber("223/197")).toBe("223");
    expect(normalizeNumber("TG05/TG30")).toBe("TG5");
    expect(normalizeNumber("SWSH284")).toBe("SWSH284");
    expect(normalizeNumber(" #4 / 102")).toBe("4");
  });

  it("leaves One Piece numbers whole", () => {
    expect(normalizeNumber("OP01-003")).toBe("OP01-003");
    expect(normalizeNumber("op05-119")).toBe("OP05-119");
  });

  it("matches Riftbound numbers with or without the set code", () => {
    expect(normalizeNumber("OGN-066/298")).toBe("66");
    expect(normalizeNumber("ogn-066")).toBe("66");
    expect(normalizeNumber("066/298")).toBe("66");
    expect(normalizeNumber("SFD-120a")).toBe("120A");
    expect(normalizeNumber("OGN-300")).toBe("300");
  });

  it("reads the printed total", () => {
    expect(numberTotal("223/197")).toBe("197");
    expect(numberTotal("TG05/TG30")).toBe("TG30");
    expect(numberTotal("OP01-003")).toBe("");
  });
});

describe("rankCandidates", () => {
  const zard = cand({ productId: 10, name: "Charizard ex - 223/197", cleanName: "Charizard ex 223 197", number: "223/197", setName: "SV03: Obsidian Flames" });
  const zardReg = cand({ productId: 11, name: "Charizard ex - 125/197", cleanName: "Charizard ex 125 197", number: "125/197", setName: "SV03: Obsidian Flames" });
  const other223 = cand({ productId: 12, name: "Pikachu", cleanName: "Pikachu", number: "223/198", setName: "SV01: Scarlet & Violet Base Set" });

  it("puts the exact number and name first", () => {
    const r = rankCandidates(read({ name: "Charizard ex", number: "223/197", setName: "Obsidian Flames" }), [other223, zardReg, zard]);
    expect(r.map((c) => c.productId)).toEqual([10, 11, 12]);
  });

  it("uses the printed total to tell same-number cards apart", () => {
    const r = rankCandidates(read({ name: "", number: "223/197" }), [other223, zard]);
    expect(r[0]?.productId).toBe(10);
  });

  it("drops candidates that share nothing with the read", () => {
    expect(rankCandidates(read({ name: "Mewtwo", number: "999/999" }), [zard])).toEqual([]);
  });
});

describe("pickPrinting", () => {
  const p = [
    { subType: "Normal", marketCents: 100 },
    { subType: "Reverse Holofoil", marketCents: 300 },
    { subType: "Holofoil", marketCents: 500 },
  ];
  it("follows the finish the scan saw", () => {
    expect(pickPrinting("reverse holo", p)).toBe("Reverse Holofoil");
    expect(pickPrinting("holo", p)).toBe("Holofoil");
    expect(pickPrinting("normal", p)).toBe("Normal");
    expect(pickPrinting("", p)).toBe("Normal");
    expect(pickPrinting("holo", [])).toBeNull();
  });
});

describe("medianCents", () => {
  it("takes the median sale in cents and ignores junk", () => {
    expect(medianCents([100, 300, 200])).toBe(20000);
    expect(medianCents([100, 200])).toBe(15000);
    expect(medianCents([0, Number.NaN])).toBeNull();
  });
});

describe("tidy names for the form", () => {
  it("drops the number TCGplayer appends and the set code prefix", () => {
    expect(tidyName("Charizard ex - 223/197", "223/197")).toBe("Charizard ex");
    expect(tidyName("Pikachu (Full Art) - TG05/TG30", "TG05/TG30")).toBe("Pikachu (Full Art)");
    expect(tidyName("Monkey.D.Luffy (Alternate Art)", "OP01-003")).toBe("Monkey.D.Luffy (Alternate Art)");
    expect(tidySet("SV03: Obsidian Flames")).toBe("Obsidian Flames");
    expect(tidySet("Romance Dawn")).toBe("Romance Dawn");
  });
});

describe("games", () => {
  it("knows Pokemon, One Piece and Riftbound", () => {
    expect(GAMES.map((g) => g.id)).toEqual(["pokemon", "one_piece", "riftbound"]);
    expect(isGame("riftbound")).toBe(true);
    expect(isGame("magic")).toBe(false);
    expect(isGame(null)).toBe(false);
  });
});
