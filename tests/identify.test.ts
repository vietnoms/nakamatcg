import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { catalogItems } from "@/db/schema";
import type { CardRead } from "@/lookup/match";
import { lookupCard, type Provider } from "@/server/identify";
import { testDb } from "./db";

let db: Db;
let close: () => Promise<void>;
const img = { bytes: new ArrayBuffer(8), mediaType: "image/jpeg" };

beforeAll(async () => {
  ({ db, close } = await testDb());
  const base = { game: "pokemon", groupId: 1, setName: "SV03: Obsidian Flames", rarity: "", imageUrl: "" };
  await db.insert(catalogItems).values([
    { ...base, productId: 1, subType: "Holofoil", name: "Charizard ex - 223/197", cleanName: "Charizard ex 223 197", number: "223/197", numberKey: "223", marketCents: 7120 },
    { ...base, productId: 2, subType: "Normal", name: "Pidgey - 162/197", cleanName: "Pidgey 162 197", number: "162/197", numberKey: "162", marketCents: 10 },
    { ...base, productId: 2, subType: "Reverse Holofoil", name: "Pidgey - 162/197", cleanName: "Pidgey 162 197", number: "162/197", numberKey: "162", marketCents: 40 },
  ]);
});
afterAll(async () => close());

const read = (o: Partial<CardRead>): CardRead => ({ game: "pokemon", name: "", setName: "", setCode: "", number: "", finish: "", graded: null, ...o });
const fixed = (r: Awaited<ReturnType<Provider>>): Provider => async () => r;
let claudeCalls = 0;
const claude: Provider = async () => {
  claudeCalls++;
  return { source: "claude", confidence: "high", read: read({ name: "Pidgey", number: "162/197", finish: "reverse holo" }) };
};

describe("lookupCard", () => {
  it("uses a confident CardSight match and preselects the catalog entry", async () => {
    claudeCalls = 0;
    const r = await lookupCard(db, img, "pokemon", {
      cardsight: fixed({ source: "cardsight", confidence: "high", cardsightId: "cs-1", read: read({ name: "Charizard ex", number: "223/197", setName: "Obsidian Flames" }) }),
      claude,
      gradedPrice: null,
    });
    expect(r).toMatchObject({ source: "cardsight", suggested: { productId: 1, subType: "Holofoil" } });
    expect(claudeCalls).toBe(0);
  });

  it("asks Claude when CardSight is unsure, and follows the finish it read", async () => {
    claudeCalls = 0;
    const r = await lookupCard(db, img, "pokemon", {
      cardsight: fixed({ source: "cardsight", confidence: "low", read: read({ name: "Pidgeotto" }) }),
      claude,
      gradedPrice: null,
    });
    expect(claudeCalls).toBe(1);
    expect(r).toMatchObject({ source: "claude", suggested: { productId: 2, subType: "Reverse Holofoil" } });
  });

  it("asks Claude when CardSight's answer matches nothing in the catalog", async () => {
    const r = await lookupCard(db, img, "pokemon", {
      cardsight: fixed({ source: "cardsight", confidence: "high", read: read({ name: "Zzzz", number: "999/999" }) }),
      claude,
      gradedPrice: null,
    });
    expect(r.source).toBe("claude");
    expect(r.notes).toContain("CardSight's answer did not match the price catalog; asked Claude");
  });

  it("survives a provider that throws and reports why", async () => {
    const r = await lookupCard(db, img, "pokemon", {
      cardsight: async () => {
        throw new Error("402 out of credits");
      },
      claude,
      gradedPrice: null,
    });
    expect(r.source).toBe("claude");
    expect(r.notes[0]).toBe("CardSight failed: 402 out of credits");
  });

  it("prices a slab from recent sales when CardSight knows the card", async () => {
    const r = await lookupCard(db, img, "pokemon", {
      cardsight: fixed({
        source: "cardsight",
        confidence: "high",
        cardsightId: "cs-1",
        read: read({ name: "Charizard ex", number: "223/197", graded: { company: "PSA", grade: "10", cert: "123" } }),
      }),
      claude: null,
      gradedPrice: async (id, company, grade) => ({ company, grade, medianCents: id === "cs-1" ? 25000 : 0, sales: 7, lastSale: "2026-10-01" }),
    });
    expect(r.graded).toEqual({ company: "PSA", grade: "10", medianCents: 25000, sales: 7, lastSale: "2026-10-01" });
  });

  it("says so when nothing is set up", async () => {
    const r = await lookupCard(db, img, "pokemon", { cardsight: null, claude: null, gradedPrice: null });
    expect(r).toMatchObject({ source: null, candidates: [], notes: ["No photo service is set up (CARDSIGHT_API_KEY or ANTHROPIC_API_KEY)"] });
  });
});
