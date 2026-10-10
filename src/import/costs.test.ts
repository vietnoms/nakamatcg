import { describe, expect, it } from "vitest";
import { detectMapping, parseCsv, parseRows } from "./collectr";
import { costBook, looseKey, takeCost } from "./costs";

const HEADER = "Portfolio Name,Category,Set,Product Name,Card Number,Rarity,Variance,Grade,Card Condition,Average Cost Paid,Quantity,Market Price (As of 2026-10-08),Price Override,Watchlist,Date Added,Notes";
const rows = (...lines: string[]) => {
  const { headers, rows } = parseCsv([HEADER, ...lines].join("\n"));
  return parseRows(rows, detectMapping(headers)).items;
};

describe("cost matching", () => {
  const main = rows(
    "Main,Pokemon,Obsidian Flames,Charizard ex,223/197,SIR,Holofoil,Ungraded,Lightly Played,60.0000,2,71.20,0,false,2026-05-02,",
    "Main,Pokemon,Evolving Skies,Umbreon VMAX,215/203,SR,Holofoil,Ungraded,Near Mint,900.0000,1,1412.37,0,false,2026-05-01,",
    "Main,Pokemon,151,Mew ex,151/165,DR,Holofoil,Ungraded,Near Mint,0.0000,1,30.00,0,false,2026-05-01,",
  );
  const display = rows(
    "Vendor,Pokemon,Evolving Skies,Umbreon VMAX,215/203,SR,Holofoil,Ungraded,Near Mint,0.0000,1,1412.37,0,false,2026-10-01,",
    "Vendor,Pokemon,Obsidian Flames,Charizard ex,223/197,SIR,Holofoil,Ungraded,Near Mint,0.0000,3,80.00,0,false,2026-10-01,",
    "Vendor,Pokemon,151,Mew ex,151/165,DR,Holofoil,Ungraded,Near Mint,0.0000,1,30.00,0,false,2026-10-01,",
  );

  it("lends each copy's cost once, matching the card in any condition when the condition differs", () => {
    const book = costBook(main);
    const [umbreon, charizard, mew] = display;
    expect(takeCost(book, umbreon!.key, looseKey(umbreon!))).toBe(90000);
    expect(takeCost(book, umbreon!.key, looseKey(umbreon!))).toBeNull();
    // scanned as NM, owned as LP: still the same card
    expect(takeCost(book, charizard!.key, looseKey(charizard!))).toBe(6000);
    expect(takeCost(book, charizard!.key, looseKey(charizard!))).toBe(6000);
    expect(takeCost(book, charizard!.key, looseKey(charizard!))).toBeNull();
    // a 0 cost in Collectr is no cost to lend
    expect(takeCost(book, mew!.key, looseKey(mew!))).toBeNull();
  });

  it("prefers the copy in the same condition", () => {
    const book = costBook(
      rows(
        "Main,Pokemon,Obsidian Flames,Charizard ex,223/197,SIR,Holofoil,Ungraded,Lightly Played,50.0000,1,71.20,0,false,2026-05-02,",
        "Main,Pokemon,Obsidian Flames,Charizard ex,223/197,SIR,Holofoil,Ungraded,Near Mint,75.0000,1,80.00,0,false,2026-05-02,",
      ),
    );
    const nm = display[1]!;
    expect(takeCost(book, nm.key, looseKey(nm))).toBe(7500);
    expect(takeCost(book, nm.key, looseKey(nm))).toBe(5000);
  });
});
