import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, products, transactionLines, transactions, unitGroups, units } from "@/db/schema";
import { badgeFor, type ProductKind } from "@/import/collectr";
import { consignmentFee, consignmentTotals, type ConsignmentTotals } from "@/lib/consignment";

/** A page's group filter: undefined = every group, null = cards in no group, else one group's id. */
export type GroupFilter = string | null | undefined;

/** Reads `?group=` ("none" for cards in no group); anything else unknown means every group. */
export function parseGroupParam(v: string | null | undefined): GroupFilter {
  if (!v) return undefined;
  if (v === "none") return null;
  return /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;
}

/** The SQL condition for a group filter on units, or undefined for every group. */
export function inGroup(f: GroupFilter): SQL | undefined {
  if (f === undefined) return undefined;
  return f === null ? isNull(units.groupId) : eq(units.groupId, f);
}

/** own: mine, for sale; consignment: someone else's, for sale; personal: my PC, not for sale */
export type GroupKind = "own" | "consignment" | "personal";

/** A unit that is for sale: not in a personal-collection group. Pricing, stickers and the POS use it. */
export const forSale = sql`(${units.groupId} is null or ${units.groupId} not in (select ${unitGroups.id} from ${unitGroups} where ${unitGroups.kind} = 'personal'))`;

/** The name of the group "Move to PC" makes when there is no personal-collection group yet. */
export const PC_NAME = "PC";

/** The personal-collection group: the first one there is, else "PC" (an existing group of that name becomes it). */
export async function personalGroup(db: Db): Promise<string> {
  const [pc] = await db.select({ id: unitGroups.id }).from(unitGroups).where(eq(unitGroups.kind, "personal")).orderBy(asc(unitGroups.createdAt)).limit(1);
  if (pc) return pc.id;
  const [named] = await db.select({ id: unitGroups.id, kind: unitGroups.kind }).from(unitGroups).where(eq(unitGroups.name, PC_NAME));
  if (named && named.kind !== "consignment") {
    await db.update(unitGroups).set({ kind: "personal", feeBps: null, minFeeCents: null }).where(eq(unitGroups.id, named.id));
    return named.id;
  }
  const [made] = await db
    .insert(unitGroups)
    .values({ name: named ? "Personal collection" : PC_NAME, kind: "personal" })
    .returning({ id: unitGroups.id });
  return made!.id;
}

/**
 * Takes my in-stock copies of a product off sale: into the personal collection, with no price, so
 * they leave pricing, the sticker queue and the POS. Consigned copies are not mine and stay put.
 */
export async function moveProductToPersonal(db: Db, productId: string, group?: GroupFilter): Promise<{ moved: number; groupId: string }> {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const groupId = await personalGroup(tx);
    const rows = await tx
      .update(units)
      .set({ groupId, priceCents: null, reprint: false, updatedAt: sql`now()` })
      .where(
        and(
          eq(units.productId, productId),
          eq(units.status, "in_stock"),
          sql`(${units.groupId} is null or ${units.groupId} in (select ${unitGroups.id} from ${unitGroups} where ${unitGroups.kind} = 'own'))`,
          inGroup(group),
        ),
      )
      .returning({ id: units.id });
    return { moved: rows.length, groupId };
  });
}

export type Group = {
  id: string;
  name: string;
  kind: GroupKind;
  feeBps: number | null;
  minFeeCents: number | null;
  note: string;
};

export type GroupSummary = Group & {
  inStock: number;
  /** in-stock copies at their price (market when unpriced) */
  stockValueCents: number;
  sold: number;
};

/** Every group with its counts, plus a row for cards in no group (id null). */
export async function listGroups(db: Db): Promise<(Omit<GroupSummary, "id"> & { id: string | null })[]> {
  const gs = await db.select().from(unitGroups).orderBy(asc(unitGroups.kind), asc(unitGroups.name));
  const counts = await db
    .select({
      groupId: units.groupId,
      inStock: sql<number>`count(*) filter (where ${units.status} = 'in_stock')::int`,
      value: sql<number>`coalesce(sum(coalesce(${units.priceCents}, ${products.marketCents}, 0)) filter (where ${units.status} = 'in_stock'), 0)::int`,
      sold: sql<number>`count(*) filter (where ${units.status} in ('sold', 'traded_out'))::int`,
    })
    .from(units)
    .innerJoin(products, eq(products.id, units.productId))
    .groupBy(units.groupId);
  const by = new Map(counts.map((c) => [c.groupId, c]));
  const row = (g: Group | null) => {
    const c = by.get(g?.id ?? null);
    return {
      ...(g ?? { id: null, name: "No group", kind: "own" as const, feeBps: null, minFeeCents: null, note: "" }),
      inStock: c?.inStock ?? 0,
      stockValueCents: c?.value ?? 0,
      sold: c?.sold ?? 0,
    };
  };
  const out: (Omit<GroupSummary, "id"> & { id: string | null })[] = gs.map((g) => row({ ...g, kind: g.kind as GroupKind }));
  const loose = row(null);
  if (loose.inStock + loose.sold > 0) out.push(loose);
  return out;
}

export async function getGroup(db: Db, id: string): Promise<Group | null> {
  const [g] = await db.select().from(unitGroups).where(eq(unitGroups.id, id));
  return g ? { ...g, kind: g.kind as GroupKind } : null;
}

export type GroupInput = { name: string; kind: GroupKind; feeBps: number | null; minFeeCents: number | null; note?: string };

function clean(input: GroupInput) {
  const name = input.name.trim();
  if (!name) throw new Error("A group needs a name.");
  const consignment = input.kind === "consignment";
  return {
    name,
    kind: input.kind,
    feeBps: consignment ? (input.feeBps ?? 0) : null,
    minFeeCents: consignment ? (input.minFeeCents ?? 0) : null,
    note: input.note?.trim() ?? "",
  };
}

export async function nameTaken(db: Db, name: string, except?: string): Promise<boolean> {
  const [g] = await db.select({ id: unitGroups.id }).from(unitGroups).where(eq(unitGroups.name, name));
  return Boolean(g && g.id !== except);
}

export async function createGroup(db: Db, input: GroupInput): Promise<string> {
  const v = clean(input);
  if (await nameTaken(db, v.name)) throw new Error(`There is already a group called "${v.name}".`);
  const [g] = await db.insert(unitGroups).values(v).returning({ id: unitGroups.id });
  return g!.id;
}

export async function updateGroup(db: Db, id: string, input: GroupInput): Promise<void> {
  const v = clean(input);
  if (await nameTaken(db, v.name, id)) throw new Error(`There is already a group called "${v.name}".`);
  await db.update(unitGroups).set(v).where(eq(unitGroups.id, id));
}

/** Deletes a group; its cards (sold ones too) are left in no group. */
export async function deleteGroup(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(units).set({ groupId: null, updatedAt: sql`now()` }).where(eq(units.groupId, id));
    await tx.delete(unitGroups).where(eq(unitGroups.id, id));
  });
}

/** Moves cards to a group (null: no group). Returns how many moved. */
export async function moveUnits(db: Db, unitIds: string[], groupId: string | null): Promise<number> {
  if (unitIds.length === 0) return 0;
  const rows = await db.update(units).set({ groupId, updatedAt: sql`now()` }).where(inArray(units.id, unitIds)).returning({ id: units.id });
  return rows.length;
}

export type GroupUnit = {
  id: string;
  code: string;
  status: string;
  kind: ProductKind;
  name: string;
  setName: string;
  cardNumber: string;
  badge: string;
  priceCents: number | null;
  marketCents: number | null;
  costCents: number | null;
};

/** The cards in a group (null: no group), in stock first. */
export async function groupUnits(db: Db, groupId: string | null): Promise<GroupUnit[]> {
  const rows = await db
    .select({
      id: units.id,
      code: units.code,
      status: units.status,
      kind: products.kind,
      name: products.name,
      setName: products.setName,
      cardNumber: products.cardNumber,
      condition: products.condition,
      grader: products.grader,
      grade: products.grade,
      priceCents: units.priceCents,
      marketCents: products.marketCents,
      costCents: units.costCents,
    })
    .from(units)
    .innerJoin(products, eq(products.id, units.productId))
    .where(groupId === null ? isNull(units.groupId) : eq(units.groupId, groupId))
    .orderBy(sql`${units.status} <> 'in_stock'`, asc(products.setName), asc(products.name), asc(units.code));
  return rows.map((r) => ({ ...r, kind: r.kind as ProductKind, badge: badgeFor({ kind: r.kind as ProductKind, condition: r.condition, grader: r.grader, grade: r.grade }) }));
}

export type ConsignmentSale = {
  transactionId: string;
  occurredAt: Date;
  how: "sold" | "traded";
  eventName: string;
  code: string;
  name: string;
  setName: string;
  cardNumber: string;
  badge: string;
  stickerCents: number | null;
  soldCents: number;
  feeCents: number;
  payoutCents: number;
};

export type ConsignmentReport = { sales: ConsignmentSale[]; totals: ConsignmentTotals };

/**
 * What a consignor's cards brought in from one day to another (both included, YYYY-MM-DD in the
 * display time zone), voided deals left out: each card's share of its deal, my fee on it, and
 * what I owe them. A card traded away counts at its trade value.
 */
export async function consignmentReport(
  db: Db,
  group: Group,
  range: { from?: string; to?: string; tz: string } = { tz: "UTC" },
): Promise<ConsignmentReport> {
  const terms = { feeBps: group.feeBps ?? 0, minFeeCents: group.minFeeCents ?? 0 };
  const voided = db.select({ id: transactions.voidsTransactionId }).from(transactions).where(isNotNull(transactions.voidsTransactionId));
  const conds = [
    eq(units.groupId, group.id),
    eq(transactionLines.direction, "out"),
    inArray(transactions.kind, ["sale", "trade"]),
    notInArray(transactions.id, sql`(${voided})`),
  ];
  const day = sql`(${transactions.occurredAt} at time zone ${range.tz})::date`;
  if (range.from) conds.push(sql`${day} >= ${range.from}::date`);
  if (range.to) conds.push(sql`${day} <= ${range.to}::date`);

  const rows = await db
    .select({
      transactionId: transactions.id,
      occurredAt: transactions.occurredAt,
      txKind: transactions.kind,
      eventName: events.name,
      code: units.code,
      kind: products.kind,
      name: products.name,
      setName: products.setName,
      cardNumber: products.cardNumber,
      condition: products.condition,
      grader: products.grader,
      grade: products.grade,
      stickerCents: transactionLines.stickerCents,
      soldCents: transactionLines.amountCents,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactions.id, transactionLines.transactionId))
    .innerJoin(units, eq(units.id, transactionLines.unitId))
    .innerJoin(products, eq(products.id, units.productId))
    .leftJoin(events, eq(events.id, transactions.eventId))
    .where(and(...conds))
    .orderBy(desc(transactions.occurredAt));

  const sales = rows.map((r) => {
    const fee = consignmentFee(r.soldCents, terms);
    return {
      transactionId: r.transactionId,
      occurredAt: r.occurredAt,
      how: r.txKind === "trade" ? ("traded" as const) : ("sold" as const),
      eventName: r.eventName ?? "",
      code: r.code,
      name: r.name,
      setName: r.setName,
      cardNumber: r.cardNumber,
      badge: badgeFor({ kind: r.kind as ProductKind, condition: r.condition, grader: r.grader, grade: r.grade }),
      stickerCents: r.stickerCents,
      soldCents: r.soldCents,
      feeCents: fee,
      payoutCents: r.soldCents - fee,
    };
  });
  return { sales, totals: consignmentTotals(rows.map((r) => r.soldCents), terms) };
}
