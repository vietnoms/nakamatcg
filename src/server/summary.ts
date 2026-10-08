import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, payments, products, transactionLines, transactions, units } from "@/db/schema";
import type { PaymentMethod } from "@/lib/settings";

export type EventRow = typeof events.$inferSelect;

export async function listEvents(db: Db): Promise<EventRow[]> {
  return db.select().from(events).orderBy(desc(events.startsOn));
}

export async function createEvent(db: Db, e: { name: string; startsOn: string; endsOn: string; startingCashCents: number }): Promise<string> {
  const [row] = await db.insert(events).values(e).returning({ id: events.id });
  return row!.id;
}

export async function setStartingCash(db: Db, eventId: string, cents: number): Promise<void> {
  await db.update(events).set({ startingCashCents: cents }).where(eq(events.id, eventId));
}

export type DealLine = {
  direction: "in" | "out";
  amountCents: number;
  costCents: number | null;
  stickerCents: number | null;
  code: string | null;
  name: string;
  detail: string;
};

export type Deal = {
  id: string;
  kind: string;
  occurredAt: Date;
  note: string;
  voided: boolean;
  lines: DealLine[];
  payments: { method: string; direction: "in" | "out"; amountCents: number }[];
};

export type Summary = {
  revenueCents: number;
  cogsCents: number;
  unknownCostLines: number;
  profitCents: number;
  feesCents: number;
  cardsSold: number;
  boughtCents: number;
  cardsBought: number;
  tradeInCents: number;
  cardsTradedIn: number;
  byMethod: { method: string; label: string; inCents: number; outCents: number }[];
  cashBoxCents: number | null;
  deals: Deal[];
};

/** Deals in scope: an event, optionally one local day of it. Voids and voided deals don't count. */
export async function summarize(
  db: Db,
  opts: { eventId: string | null; day?: string; tz: string; methods: PaymentMethod[]; startingCashCents?: number },
): Promise<Summary> {
  const where: SQL[] = [sql`${transactions.kind} <> 'void'`];
  if (opts.eventId) where.push(eq(transactions.eventId, opts.eventId));
  else where.push(sql`${transactions.eventId} is null`);
  if (opts.day) where.push(sql`(${transactions.occurredAt} at time zone ${opts.tz})::date = ${opts.day}::date`);

  const txns = await db
    .select()
    .from(transactions)
    .where(and(...where))
    .orderBy(desc(transactions.occurredAt));
  const ids = txns.map((t) => t.id);

  const voidedRows = ids.length
    ? await db
        .select({ id: transactions.voidsTransactionId })
        .from(transactions)
        .where(and(isNotNull(transactions.voidsTransactionId), inArray(transactions.voidsTransactionId, ids)))
    : [];
  const voided = new Set(voidedRows.map((v) => v.id!));

  const lines = ids.length
    ? await db
        .select({
          transactionId: transactionLines.transactionId,
          direction: transactionLines.direction,
          amountCents: transactionLines.amountCents,
          costCents: transactionLines.costCents,
          stickerCents: transactionLines.stickerCents,
          description: transactionLines.description,
          code: units.code,
          name: products.name,
          setName: products.setName,
          cardNumber: products.cardNumber,
        })
        .from(transactionLines)
        .leftJoin(units, eq(units.id, transactionLines.unitId))
        .leftJoin(products, eq(products.id, units.productId))
        .where(inArray(transactionLines.transactionId, ids))
        .orderBy(asc(transactionLines.id))
    : [];
  const pays = ids.length ? await db.select().from(payments).where(inArray(payments.transactionId, ids)) : [];

  const deals: Deal[] = txns.map((t) => ({
    id: t.id,
    kind: t.kind,
    occurredAt: t.occurredAt,
    note: t.note,
    voided: voided.has(t.id),
    lines: lines
      .filter((l) => l.transactionId === t.id)
      .map((l) => ({
        direction: l.direction as "in" | "out",
        amountCents: l.amountCents,
        costCents: l.costCents,
        stickerCents: l.stickerCents,
        code: l.code,
        name: l.name ?? l.description,
        detail: [l.setName, l.cardNumber && `#${l.cardNumber}`].filter(Boolean).join(" "),
      })),
    payments: pays
      .filter((p) => p.transactionId === t.id)
      .map((p) => ({ method: p.method, direction: p.direction as "in" | "out", amountCents: p.amountCents })),
  }));

  const live = deals.filter((d) => !d.voided);
  const s: Summary = {
    revenueCents: 0,
    cogsCents: 0,
    unknownCostLines: 0,
    profitCents: 0,
    feesCents: 0,
    cardsSold: 0,
    boughtCents: 0,
    cardsBought: 0,
    tradeInCents: 0,
    cardsTradedIn: 0,
    byMethod: [],
    cashBoxCents: null,
    deals,
  };
  const fee = new Map(opts.methods.map((m) => [m.id, m.feePercent]));
  const by = new Map<string, { inCents: number; outCents: number }>();
  for (const d of live) {
    for (const l of d.lines) {
      if (l.direction === "out") {
        s.revenueCents += l.amountCents;
        if (l.code) {
          s.cardsSold++;
          if (l.costCents === null) s.unknownCostLines++;
          else s.cogsCents += l.costCents;
        }
      } else if (d.kind === "trade") {
        s.tradeInCents += l.amountCents;
        s.cardsTradedIn++;
      } else {
        s.boughtCents += l.amountCents;
        s.cardsBought++;
      }
    }
    for (const p of d.payments) {
      const m = by.get(p.method) ?? { inCents: 0, outCents: 0 };
      if (p.direction === "in") {
        m.inCents += p.amountCents;
        s.feesCents += Math.round((p.amountCents * (fee.get(p.method) ?? 0)) / 100);
      } else m.outCents += p.amountCents;
      by.set(p.method, m);
    }
  }
  s.profitCents = s.revenueCents - s.cogsCents - s.feesCents;
  const label = new Map(opts.methods.map((m) => [m.id, m.label]));
  s.byMethod = [...by.entries()]
    .map(([method, v]) => ({ method, label: label.get(method) ?? method, ...v }))
    .sort((a, b) => b.inCents - a.inCents);
  if (opts.startingCashCents !== undefined) {
    const cash = by.get("cash") ?? { inCents: 0, outCents: 0 };
    s.cashBoxCents = opts.startingCashCents + cash.inCents - cash.outCents;
  }
  return s;
}

/** Local days that have deals in an event, newest first. */
export async function eventDays(db: Db, eventId: string | null, tz: string): Promise<string[]> {
  const day = sql<string>`to_char((${transactions.occurredAt} at time zone ${tz})::date, 'YYYY-MM-DD')`;
  const rows = await db
    .selectDistinct({ day })
    .from(transactions)
    .where(eventId ? eq(transactions.eventId, eventId) : sql`${transactions.eventId} is null`)
    // by position: the same expression twice gets two parameters, which DISTINCT treats as different
    .orderBy(sql`1 desc`);
  return rows.map((r) => r.day);
}
