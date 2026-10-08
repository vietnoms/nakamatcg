/**
 * Phone <-> server. pull() merges the server's inventory into IndexedDB; push() sends the
 * outbox. After every pull the effects of still-pending deals are re-applied locally, so a card
 * sold offline never pops back to "in stock" because the server has not heard yet.
 */
import { dealBalance, type DealOp, type Op } from "@/lib/ops";
import { getMeta, posDb, setMeta, type LocalDeal, type LocalSettings } from "./db";
import type { PosSnapshot, PosUnit } from "./types";

export type SyncState = {
  online: boolean;
  signedOut: boolean;
  pending: number;
  errors: number;
  lastPull: string | null;
  lastError: string | null;
  busy: boolean;
};

/** Marks units out, adds units in, or reverses a voided deal, on this device only. */
export async function applyLocal(op: Op): Promise<void> {
  const db = posDb();
  // read before the transaction: it only spans units and deals
  const orig = op.type === "void" ? await findOp(op.voidsId) : undefined;
  await db.transaction("rw", [db.units, db.deals], async () => {
    if (op.type === "deal") {
      const gone = op.kind === "trade" ? "traded_out" : "sold";
      for (const l of op.out) await db.units.update(l.unitId, { status: gone });
      for (const l of op.in) {
        const u: PosUnit = {
          id: l.unitId,
          code: l.code,
          status: "in_stock",
          priceCents: l.priceCents,
          costCents: l.costCents,
          productId: "",
          kind: l.product.kind,
          name: l.product.name,
          setName: l.product.setName,
          cardNumber: l.product.cardNumber,
          variant: l.product.variant,
          badge: l.product.kind === "slab" ? `${l.product.grader} ${l.product.grade}`.trim() : l.product.kind === "sealed" ? "Sealed" : l.product.condition,
          marketCents: l.product.marketCents,
          updatedAt: op.occurredAt,
        };
        await db.units.put(u);
      }
    } else {
      const deal = orig?.type === "deal" ? orig : undefined;
      if (deal) {
        for (const l of deal.out) await db.units.update(l.unitId, { status: "in_stock" });
        for (const l of deal.in) await db.units.update(l.unitId, { status: "removed" });
      }
      await db.deals.update(op.voidsId, { voidedBy: op.id });
    }
  });
}

/** Records a deal on this device: outbox, local effects, history. Then the caller kicks a push. */
export async function recordDeal(op: DealOp, summary: string): Promise<void> {
  const balance = dealBalance(op);
  if (balance !== 0) throw new Error(`This deal is off by ${(balance / 100).toFixed(2)}. Check the amounts.`);
  const db = posDb();
  const net = op.payments.reduce((n, p) => n + (p.direction === "in" ? p.amountCents : -p.amountCents), 0);
  const deal: LocalDeal = { id: op.id, kind: op.kind, occurredAt: op.occurredAt, eventId: op.eventId, netCents: net, summary, voidedBy: null, synced: false };
  await db.transaction("rw", [db.outbox, db.deals], async () => {
    await db.outbox.put({ id: op.id, op, createdAt: new Date().toISOString(), state: "pending" });
    await db.deals.put(deal);
  });
  await applyLocal(op);
}

export async function recordVoid(dealId: string, device: string): Promise<void> {
  const db = posDb();
  const op: Op = { type: "void", id: crypto.randomUUID(), voidsId: dealId, occurredAt: new Date().toISOString(), note: "", device };
  // keep the original op around (even once synced) so the local reversal knows what to undo
  await db.outbox.put({ id: op.id, op, createdAt: new Date().toISOString(), state: "pending" });
  await applyLocal(op);
}

async function replayPending(): Promise<void> {
  const db = posDb();
  const items = await db.outbox.orderBy("createdAt").toArray();
  for (const it of items) if (it.state === "pending") await applyLocal(it.op);
}

export async function pull(full = false): Promise<void> {
  const since = full ? null : await getMeta<string>("lastPull");
  const res = await fetch(`/api/pos/snapshot${since ? `?since=${encodeURIComponent(since)}` : ""}`, { cache: "no-store" });
  if (res.status === 401) throw new SignedOut();
  if (!res.ok) throw new Error(`snapshot failed (${res.status})`);
  const snap = (await res.json()) as PosSnapshot;
  const db = posDb();
  await db.transaction("rw", [db.units, db.products, db.meta], async () => {
    if (snap.full) {
      await db.units.clear();
      await db.products.clear();
    }
    // a unit's code is unique: drop a stale local row that holds the code under another id
    // (a card bought offline whose code the server had to replace)
    if (!snap.full) {
      for (const u of snap.units) {
        const clash = await db.units.where("code").equals(u.code).first();
        if (clash && clash.id !== u.id) await db.units.delete(clash.id);
      }
    }
    await db.units.bulkPut(snap.units);
    await db.products.bulkPut(snap.products);
    const settings: LocalSettings = { ...snap.settings, events: snap.events };
    await db.meta.put({ key: "settings", value: settings });
    await db.meta.put({ key: "lastPull", value: snap.serverTime });
  });
  await replayPending();
}

export class SignedOut extends Error {
  constructor() {
    super("signed out");
  }
}

type Result = { id: string; status: "applied" | "duplicate" | "error"; error?: string; conflicts?: string[] };

/** Sends pending ops in order, 50 at a time. Ops the server refused stay in the outbox as errors. */
export async function push(): Promise<{ sent: number; errors: number }> {
  const db = posDb();
  let sent = 0;
  let errors = 0;
  for (;;) {
    const batch = (await db.outbox.orderBy("createdAt").toArray()).filter((i) => i.state === "pending").slice(0, 50);
    if (batch.length === 0) break;
    const res = await fetch("/api/pos/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops: batch.map((b) => b.op) }),
    });
    if (res.status === 401) throw new SignedOut();
    if (!res.ok) throw new Error(`sync failed (${res.status})`);
    const { results } = (await res.json()) as { results: Result[] };
    for (const r of results) {
      const item = batch.find((b) => b.id === r.id);
      if (!item) continue;
      if (r.status === "error") {
        errors++;
        await db.outbox.update(r.id, { state: "error", error: r.error ?? "refused" });
        continue;
      }
      sent++;
      await db.transaction("rw", [db.outbox, db.deals, db.meta], async () => {
        // keep synced deals' ops in a side table for local voids; drop them from the outbox
        await db.meta.put({ key: `op:${r.id}`, value: item.op });
        await db.outbox.delete(r.id);
        if (item.op.type === "deal") await db.deals.update(r.id, { synced: true, conflicts: r.conflicts });
      });
    }
    if (results.every((r) => r.status === "error")) break;
  }
  return { sent, errors };
}

/** Finds a deal's op whether it is still in the outbox or already synced. */
export async function findOp(id: string): Promise<Op | undefined> {
  const db = posDb();
  return (await db.outbox.get(id))?.op ?? (await getMeta<Op>(`op:${id}`));
}

export async function retryErrors(): Promise<void> {
  const db = posDb();
  await db.outbox.where("state").equals("error").modify({ state: "pending", error: undefined });
}

export async function counts(): Promise<{ pending: number; errors: number }> {
  const db = posDb();
  const [pending, errors] = await Promise.all([db.outbox.where("state").equals("pending").count(), db.outbox.where("state").equals("error").count()]);
  return { pending, errors };
}

export async function lastDeals(limit = 50): Promise<LocalDeal[]> {
  return posDb().deals.orderBy("occurredAt").reverse().limit(limit).toArray();
}

export async function deviceName(): Promise<string> {
  let d = await getMeta<string>("device");
  if (!d) {
    d = `phone-${crypto.randomUUID().slice(0, 4)}`;
    await setMeta("device", d);
  }
  return d;
}
