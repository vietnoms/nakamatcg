import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { catalogItems } from "@/db/schema";
import { rankCandidates } from "@/lookup/match";
import { candidatesFor, catalogStatus, searchCatalog, syncCatalog, type Fetcher } from "@/server/catalog";
import { testDb } from "./db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(async () => close());

/** A tiny fake tcgcsv.com: one Pokemon set, one One Piece set. */
function fakeTcgcsv(market = 71.2): Fetcher {
  const data: Record<string, unknown> = {
    "https://tcgcsv.com/tcgplayer/3/groups": { results: [{ groupId: 23228, name: "SV03: Obsidian Flames" }] },
    "https://tcgcsv.com/tcgplayer/3/23228/products": {
      results: [
        { productId: 509640, name: "Charizard ex - 223/197", cleanName: "Charizard ex 223 197", imageUrl: "https://img/509640.jpg", groupId: 23228, extendedData: [{ name: "Number", value: "223/197" }, { name: "Rarity", value: "Special Illustration Rare" }] },
        { productId: 509500, name: "Charizard ex - 125/197", cleanName: "Charizard ex 125 197", imageUrl: "", groupId: 23228, extendedData: [{ name: "Number", value: "125/197" }] },
        { productId: 509999, name: "Obsidian Flames Booster Pack", cleanName: "Obsidian Flames Booster Pack", imageUrl: "", groupId: 23228 },
      ],
    },
    "https://tcgcsv.com/tcgplayer/3/23228/prices": {
      results: [
        { productId: 509640, subTypeName: "Holofoil", marketPrice: market, lowPrice: 65 },
        { productId: 509500, subTypeName: "Holofoil", marketPrice: 8.5, lowPrice: 7 },
        { productId: 509500, subTypeName: "Reverse Holofoil", marketPrice: 9.1, lowPrice: null },
      ],
    },
    "https://tcgcsv.com/tcgplayer/68/groups": { results: [{ groupId: 3188, name: "Romance Dawn" }] },
    "https://tcgcsv.com/tcgplayer/68/3188/products": {
      results: [{ productId: 453000, name: "Monkey.D.Luffy (Alternate Art)", cleanName: "MonkeyDLuffy Alternate Art", imageUrl: "", groupId: 3188, extendedData: [{ name: "Number", value: "OP01-003" }] }],
    },
    "https://tcgcsv.com/tcgplayer/68/3188/prices": { results: [{ productId: 453000, subTypeName: "Normal", marketPrice: 1550, lowPrice: 1400 }] },
  };
  return async (url) => {
    if (!(url in data)) throw new Error(`unexpected ${url}`);
    return data[url];
  };
}

describe("syncCatalog", () => {
  it("stores one row per product and printing, with market prices in cents", async () => {
    const res = await syncCatalog(db, fakeTcgcsv());
    expect(res).toEqual({ items: 5, sets: 2 });
    const rows = await db.select().from(catalogItems);
    expect(rows.find((r) => r.productId === 509640)).toMatchObject({ game: "pokemon", numberKey: "223", marketCents: 7120, rarity: "Special Illustration Rare", setName: "SV03: Obsidian Flames" });
    expect(rows.find((r) => r.productId === 509999)).toMatchObject({ subType: "", marketCents: null });
    expect(rows.find((r) => r.productId === 453000)).toMatchObject({ game: "one_piece", numberKey: "OP01-003", marketCents: 155000 });
  });

  it("a second sync updates prices in place and records the run", async () => {
    await syncCatalog(db, fakeTcgcsv(80));
    const rows = await db.select().from(catalogItems);
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.productId === 509640)?.marketCents).toBe(8000);
    const s = await catalogStatus(db);
    expect(s.items).toBe(5);
    expect(s.lastOk?.items).toBe(5);
  });

  it("records a failed run without losing the catalog", async () => {
    await expect(syncCatalog(db, async () => { throw new Error("tcgcsv down"); })).rejects.toThrow("tcgcsv down");
    const s = await catalogStatus(db);
    expect(s.last?.error).toBe("tcgcsv down");
    expect(s.items).toBe(5);
  });
});

describe("finding cards", () => {
  it("candidatesFor + rank puts the scanned card first, with its printings", async () => {
    const read = { game: "pokemon" as const, name: "Charizard ex", setName: "Obsidian Flames", setCode: "OBF", number: "223/197", finish: "", graded: null };
    const ranked = rankCandidates(read, await candidatesFor(db, read));
    expect(ranked[0]).toMatchObject({ productId: 509640, printings: [{ subType: "Holofoil", marketCents: 8000 }] });
    expect(ranked.map((r) => r.productId)).toContain(509500);
  });

  it("matches One Piece by its card number", async () => {
    const read = { game: "one_piece" as const, name: "Monkey.D.Luffy", setName: "", setCode: "", number: "OP01-003", finish: "", graded: { company: "CGC", grade: "10 Pristine", cert: "" } };
    const ranked = rankCandidates(read, await candidatesFor(db, read));
    expect(ranked[0]?.productId).toBe(453000);
  });

  it("typed search matches name, set, and number, priciest first", async () => {
    const r = await searchCatalog(db, "charizard obsidian", "pokemon");
    expect(r.map((c) => c.productId)).toEqual([509640, 509500]);
    expect((await searchCatalog(db, "OP01-003", null)).map((c) => c.productId)).toEqual([453000]);
    expect(await searchCatalog(db, "   ", null)).toEqual([]);
  });
});
