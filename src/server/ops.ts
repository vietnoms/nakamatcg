import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { payments, products, syncConflicts, transactionLines, transactions, units } from "@/db/schema";
import { productKey } from "@/import/collectr";
import { dealBalance, Op, type DealOp, type ProductInput, type VoidOp } from "@/lib/ops";
import { freshCodes } from "./import";

export type OpResult = { id: string; status: "applied" | "duplicate" | "error"; error?: string; conflicts?: string[] };

/** Find a product by its natural key, or create it (a card bought at the show that we never had). */
async function productFor(tx: Db, p: ProductInput): Promise<string> {
  const base = {
    game: "",
    name: p.name,
    setName: p.setName,
    cardNumber: p.cardNumber,
    variant: p.variant,
    rarity: "",
    condition: p.kind === "raw" ? p.condition : "",
    grader: p.kind === "slab" ? p.grader.toUpperCase() : "",
    grade: p.kind === "slab" ? p.grade : "",
    cert: p.kind === "slab" ? p.cert : "",
    language: "",
  };
  const key = productKey(base);
  const [found] = await tx.select({ id: products.id }).from(products).where(eq(products.naturalKey, key)).limit(1);
  if (found) return found.id;
  const [made] = await tx
    .insert(products)
    .values({ ...base, kind: p.kind, naturalKey: key, marketCents: p.marketCents, marketUpdatedAt: p.marketCents === null ? null : sql`now()` })
    .returning({ id: products.id });
  return made!.id;
}

async function applyDeal(tx: Db, d: DealOp): Promise<string[]> {
  const conflicts: string[] = [];
  const balance = dealBalance(d);
  if (balance !== 0) conflicts.push(`does not balance by ${balance} cents`);

  await tx.insert(transactions).values({
    id: d.id,
    kind: d.kind,
    eventId: d.eventId,
    occurredAt: new Date(d.occurredAt),
    note: d.note,
    device: d.device,
  });

  // cards out: lock them, mark them gone, keep their cost for profit
  const outIds = d.out.map((l) => l.unitId);
  const current = outIds.length
    ? await tx
        .select({ id: units.id, code: units.code, status: units.status, costCents: units.costCents })
        .from(units)
        .where(inArray(units.id, outIds))
        .for("update")
    : [];
  const byId = new Map(current.map((u) => [u.id, u]));
  const gone = d.kind === "trade" ? "traded_out" : "sold";
  for (const l of d.out) {
    const u = byId.get(l.unitId);
    if (!u) {
      conflicts.push(`unknown unit ${l.unitId}`);
      await tx.insert(transactionLines).values({
        transactionId: d.id,
        direction: "out",
        amountCents: l.amountCents,
        stickerCents: l.stickerCents,
        description: `unknown unit ${l.unitId}`,
      });
      continue;
    }
    if (u.status !== "in_stock") conflicts.push(`${u.code} was already ${u.status}`);
    else await tx.update(units).set({ status: gone, updatedAt: sql`now()` }).where(eq(units.id, u.id));
    await tx.insert(transactionLines).values({
      transactionId: d.id,
      unitId: u.id,
      direction: "out",
      amountCents: l.amountCents,
      stickerCents: l.stickerCents,
      costCents: u.costCents,
    });
  }

  for (const m of d.misc) {
    await tx.insert(transactionLines).values({ transactionId: d.id, direction: "out", amountCents: m.amountCents, description: m.description });
  }

  // cards in: new units with the phone's ids and codes (a code already taken gets a fresh one)
  if (d.in.length) {
    const wanted = d.in.map((l) => l.code);
    const taken = new Set(
      (await tx.select({ code: units.code }).from(units).where(inArray(units.code, wanted))).map((r) => r.code),
    );
    const replacements = await freshCodes(tx, d.in.filter((l) => taken.has(l.code)).length);
    for (const l of d.in) {
      let code = l.code;
      if (taken.has(code)) {
        code = replacements.shift()!;
        conflicts.push(`code ${l.code} was taken; the card got ${code}`);
      }
      const productId = await productFor(tx, l.product);
      await tx.insert(units).values({
        id: l.unitId,
        code,
        productId,
        costCents: l.costCents,
        acquiredAt: new Date(d.occurredAt),
        source: d.kind === "trade" ? "trade_in" : "buy",
        priceCents: l.priceCents,
      });
      await tx.insert(transactionLines).values({
        transactionId: d.id,
        unitId: l.unitId,
        direction: "in",
        amountCents: l.costCents,
        costCents: l.costCents,
      });
    }
  }

  if (d.payments.length) {
    await tx.insert(payments).values(d.payments.map((p) => ({ transactionId: d.id, ...p })));
  }
  return conflicts;
}

/** "noop" when another void already cancelled the deal (two phones voiding the same sale). */
async function applyVoid(tx: Db, v: VoidOp): Promise<string[] | "noop"> {
  const [orig] = await tx.select().from(transactions).where(eq(transactions.id, v.voidsId)).limit(1);
  if (!orig) throw new Error("the deal to void is not on the server");
  if (orig.kind === "void") throw new Error("a void cannot be voided");
  const [already] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.voidsTransactionId, v.voidsId))
    .limit(1);
  if (already) return "noop";

  await tx.insert(transactions).values({
    id: v.id,
    kind: "void",
    eventId: orig.eventId,
    occurredAt: new Date(v.occurredAt),
    note: v.note,
    device: v.device,
    voidsTransactionId: v.voidsId,
  });

  const lines = await tx.select().from(transactionLines).where(eq(transactionLines.transactionId, v.voidsId));
  const outIds = lines.filter((l) => l.direction === "out" && l.unitId).map((l) => l.unitId!);
  const inIds = lines.filter((l) => l.direction === "in" && l.unitId).map((l) => l.unitId!);
  // cards that left come back; cards that came in never happened
  if (outIds.length) {
    await tx
      .update(units)
      .set({ status: "in_stock", updatedAt: sql`now()` })
      .where(and(inArray(units.id, outIds), inArray(units.status, ["sold", "traded_out"])));
  }
  if (inIds.length) await tx.update(units).set({ status: "removed", updatedAt: sql`now()` }).where(inArray(units.id, inIds));
  return [];
}

/** Applies ops in order, each in its own database transaction. Never throws for one bad op. */
export async function applyOps(db: Db, raw: unknown[]): Promise<OpResult[]> {
  const results: OpResult[] = [];
  for (const r of raw) {
    const parsed = Op.safeParse(r);
    const id = typeof (r as { id?: unknown })?.id === "string" ? (r as { id: string }).id : "";
    if (!parsed.success) {
      results.push({ id, status: "error", error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      continue;
    }
    const op = parsed.data;
    try {
      const res = await db.transaction(async (tx0) => {
        const tx = tx0 as unknown as Db;
        const [dup] = await tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, op.id)).limit(1);
        if (dup) return { id: op.id, status: "duplicate" as const };
        const conflicts = op.type === "deal" ? await applyDeal(tx, op) : await applyVoid(tx, op);
        if (conflicts === "noop") return { id: op.id, status: "duplicate" as const };
        if (conflicts.length) {
          await tx.insert(syncConflicts).values(conflicts.map((reason) => ({ transactionId: op.id, reason })));
        }
        return { id: op.id, status: "applied" as const, ...(conflicts.length ? { conflicts } : {}) };
      });
      results.push(res);
    } catch (e) {
      results.push({ id: op.id, status: "error", error: e instanceof Error ? e.message : "failed" });
    }
  }
  return results;
}
