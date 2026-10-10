import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { unitGroups, units } from "@/db/schema";
import { detectMapping, parseCsv, parseRows } from "@/import/collectr";
import { realizedGains, unrealizedGains } from "@/server/gains";
import { consignmentReport, createGroup, deleteGroup, getGroup, groupUnits, listGroups, moveProductToPersonal, moveUnits, parseGroupParam } from "@/server/groups";
import { applyImport, planImport } from "@/server/import";
import { inventoryCounts, labelQueue, pricingRows, setProductPrice } from "@/server/inventory";
import { posSnapshot } from "@/server/pos";
import { summarize } from "@/server/summary";
import { applyOps } from "@/server/ops";
import { testDb } from "./db";

const csv = readFileSync(path.join(__dirname, "../fixtures/collectr/sample.csv"), "utf8");
const parse = (text: string) => {
  const { headers, rows } = parseCsv(text);
  return parseRows(rows, detectMapping(headers)).items;
};

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(async () => close());

const groupNamed = async (name: string) => (await db.select().from(unitGroups).where(eq(unitGroups.name, name)))[0]!;

describe("groups from Collectr portfolios", () => {
  it("puts each copy in a group named after its portfolio", async () => {
    const res = await applyImport(db, parse(csv), "sample.csv");
    expect(res.newGroups).toBe(2);
    const show = await groupNamed("Show Stock");
    const personal = await groupNamed("Personal");
    expect(show.kind).toBe("own");
    const all = await db.select().from(units);
    expect(all.filter((u) => u.groupId === personal.id)).toHaveLength(1);
    expect(all.filter((u) => u.groupId === show.id)).toHaveLength(12);
  });

  it("gives copies imported before groups existed their portfolio's group on the next import", async () => {
    await db.update(units).set({ groupId: null });
    expect((await planImport(db, parse(csv))).ungrouped).toBe(13);
    const res = await applyImport(db, parse(csv), "again.csv");
    expect(res).toMatchObject({ newUnits: 0, newGroups: 0, grouped: 13 });
    expect(await db.select().from(units).where(isNull(units.groupId))).toHaveLength(0);
  });

  it("moves cards between groups and deletes a group without losing its cards", async () => {
    const personal = await groupNamed("Personal");
    const show = await groupNamed("Show Stock");
    const [card] = await groupUnits(db, personal.id);
    expect(await moveUnits(db, [card!.id], show.id)).toBe(1);
    expect(await groupUnits(db, personal.id)).toHaveLength(0);
    await deleteGroup(db, personal.id);
    expect(await getGroup(db, personal.id)).toBeNull();
    expect((await listGroups(db)).map((g) => g.name)).toEqual(["Show Stock"]);
  });
});

describe("consignment", () => {
  let groupId: string;

  it("imports a consignor's file apart from my own copies of the same cards, with no cost", async () => {
    groupId = await createGroup(db, { name: "Alex (consigned)", kind: "consignment", feeBps: 1500, minFeeCents: 100 });
    const target = { kind: "consignment" as const, groupId };
    expect((await planImport(db, parse(csv), target)).newUnits).toBe(13);
    await applyImport(db, parse(csv), "alex.csv", target);
    const theirs = await db.select().from(units).where(eq(units.groupId, groupId));
    expect(theirs).toHaveLength(13);
    expect(theirs.every((u) => u.costCents === null)).toBe(true);
    // neither side's re-import adds the other's copies
    expect((await planImport(db, parse(csv), target)).newUnits).toBe(0);
    expect((await planImport(db, parse(csv))).newUnits).toBe(0);
  });

  it("works out my fee and what I owe on what sold, leaving voided deals out", async () => {
    const theirs = (await groupUnits(db, groupId)).slice(0, 3);
    const sale = (unitId: string, amountCents: number) => ({
      type: "deal",
      id: randomUUID(),
      kind: "sale",
      occurredAt: new Date().toISOString(),
      eventId: null,
      note: "",
      device: "test",
      out: [{ unitId, amountCents, stickerCents: amountCents }],
      misc: [],
      in: [],
      payments: [{ method: "cash", direction: "in", amountCents }],
    });
    const a = sale(theirs[0]!.id, 10000);
    const b = sale(theirs[1]!.id, 500);
    const c = sale(theirs[2]!.id, 2000);
    await applyOps(db, [a, b, c, { type: "void", id: randomUUID(), occurredAt: new Date().toISOString(), voidsId: c.id, device: "test" }]);

    const group = (await getGroup(db, groupId))!;
    const report = await consignmentReport(db, group);
    // 15% of $100 = $15; 15% of $5 = $0.75, raised to the $1 minimum
    expect(report.totals).toEqual({ cards: 2, soldCents: 10500, feeCents: 1600, payoutCents: 8900 });
    expect(report.sales.map((s) => s.feeCents).sort((x, y) => x - y)).toEqual([100, 1500]);

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    expect((await consignmentReport(db, group, { from: tomorrow, tz: "UTC" })).totals.cards).toBe(0);
    expect((await consignmentReport(db, group, { from: today, to: today, tz: "UTC" })).totals.cards).toBe(2);
  });

  it("keeps consigned cards out of my gains", async () => {
    const realized = await realizedGains(db);
    expect(realized).toHaveLength(0);
    const unrealized = await unrealizedGains(db);
    const counted = unrealized.rows.reduce((n, r) => n + r.qty, 0) + unrealized.unknownCost + unrealized.noMarket;
    const mineInStock = (await db.select().from(units).where(eq(units.status, "in_stock"))).filter((u) => u.groupId !== groupId).length;
    expect(counted).toBe(mineInStock);
  });
});

describe("personal collection (PC)", () => {
  it("takes my copies of a card off pricing, stickers and the POS; consigned copies stay for sale", async () => {
    const [umbreon] = (await pricingRows(db)).filter((r) => r.name.startsWith("Umbreon"));
    expect(umbreon!.inStock).toBe(2); // mine and Alex's
    await setProductPrice(db, umbreon!.productId, 150000);
    const queued = (await labelQueue(db)).filter((l) => l.name.startsWith("Umbreon"));
    expect(queued).toHaveLength(2);
    // each sticker knows its group, so a consignor's batch can be printed on its own
    expect(queued.map((l) => l.groupName).sort()).toEqual(["Alex (consigned)", "Show Stock"]);
    const before = await inventoryCounts(db);

    const res = await moveProductToPersonal(db, umbreon!.productId);
    expect(res.moved).toBe(1);
    const pc = (await getGroup(db, res.groupId))!;
    expect(pc).toMatchObject({ name: "PC", kind: "personal" });
    const [mine] = await groupUnits(db, pc.id);
    expect(mine).toMatchObject({ name: umbreon!.name, priceCents: null });

    expect((await pricingRows(db)).find((r) => r.productId === umbreon!.productId)?.inStock).toBe(1);
    expect((await labelQueue(db)).filter((l) => l.name.startsWith("Umbreon"))).toHaveLength(1);
    expect((await inventoryCounts(db)).inStock).toBe(before.inStock - 1);

    // re-pricing the card leaves the PC copy alone
    await setProductPrice(db, umbreon!.productId, 160000);
    expect((await groupUnits(db, pc.id))[0]!.priceCents).toBeNull();

    // the phone sees it as off the table
    const snap = await posSnapshot(db, null);
    expect(snap.units.find((u) => u.id === mine!.id)?.status).toBe("removed");

    // a second Move to PC reuses the same group
    expect((await moveProductToPersonal(db, umbreon!.productId)).groupId).toBe(pc.id);
  });

  it("does not add a PC copy back on re-import", async () => {
    expect((await planImport(db, parse(csv))).newUnits).toBe(0);
  });
});

describe("separating by group", () => {
  it("reads ?group=: none for cards in no group, anything unknown for every group", () => {
    const id = randomUUID();
    expect(parseGroupParam(id)).toBe(id);
    expect(parseGroupParam("none")).toBeNull();
    expect(parseGroupParam("")).toBeUndefined();
    expect(parseGroupParam("x' or 1=1")).toBeUndefined();
  });

  it("prices one group's copies without touching another's", async () => {
    const show = await groupNamed("Show Stock");
    const alex = await groupNamed("Alex (consigned)");
    const [card] = (await pricingRows(db, { group: alex.id })).filter((r) => r.inStock > 0 && !r.name.startsWith("Umbreon"));
    const mineBefore = (await pricingRows(db, { group: show.id })).find((r) => r.productId === card!.productId);
    await setProductPrice(db, card!.productId, 4321, alex.id);
    expect((await pricingRows(db, { group: alex.id })).find((r) => r.productId === card!.productId)?.priceCents).toBe(4321);
    expect((await pricingRows(db, { group: show.id })).find((r) => r.productId === card!.productId)?.priceCents).toBe(mineBefore?.priceCents);
    expect(await pricingRows(db, { group: null })).toHaveLength(0);
    const counts = await inventoryCounts(db, { group: alex.id });
    expect(counts.inStock).toBe((await groupUnits(db, alex.id)).filter((u) => u.status === "in_stock").length);
  });

  it("counts only a group's cards in a deal that mixes groups, splitting the card fee by its share", async () => {
    const show = await groupNamed("Show Stock");
    const alex = await groupNamed("Alex (consigned)");
    const mine = (await groupUnits(db, show.id)).find((u) => u.status === "in_stock")!;
    const theirs = (await groupUnits(db, alex.id)).find((u) => u.status === "in_stock")!;
    const eventId = null;
    await applyOps(db, [
      {
        type: "deal",
        id: randomUUID(),
        kind: "sale",
        occurredAt: new Date().toISOString(),
        eventId,
        note: "",
        device: "test",
        out: [
          { unitId: mine.id, amountCents: 3000, stickerCents: 3000 },
          { unitId: theirs.id, amountCents: 1000, stickerCents: 1000 },
        ],
        misc: [],
        in: [],
        payments: [{ method: "card", direction: "in", amountCents: 4000 }],
      },
    ]);
    const methods = [
      { id: "cash", label: "Cash", feePercent: 0 },
      { id: "card", label: "Card", feePercent: 3 },
    ];
    const all = await summarize(db, { eventId, tz: "UTC", methods, startingCashCents: 0 });
    const g = await summarize(db, { eventId, tz: "UTC", methods, startingCashCents: 0, group: alex.id });
    expect(g.groupView).toBe(true);
    // the earlier consignment sales plus this deal's Alex card; my card is not in it
    expect(g.deals.flatMap((d) => d.lines).every((l) => l.code !== mine.code)).toBe(true);
    expect(g.deals.some((d) => d.lines.some((l) => l.code === theirs.code))).toBe(true);
    expect(g.byMethod).toEqual([]);
    expect(g.cashBoxCents).toBeNull();
    expect(all.cashBoxCents).not.toBeNull();
    // 3% of $40 = $1.20 for the deal; Alex's card was a quarter of it
    expect(g.feesCents).toBe(30);
    const mineView = await summarize(db, { eventId, tz: "UTC", methods, group: show.id });
    expect(mineView.feesCents).toBe(90);
    expect(mineView.revenueCents + g.revenueCents).toBe(all.revenueCents);
  });
});
