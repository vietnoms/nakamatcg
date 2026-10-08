/**
 * The phone's offline store (IndexedDB via Dexie): the inventory snapshot, an outbox of deals
 * not yet on the server, and this device's recent deals for the history tab and "void".
 */
import Dexie, { type Table } from "dexie";
import type { Op } from "@/lib/ops";
import type { PosEvent, PosProduct, PosSnapshot, PosUnit } from "./types";

export type OutboxItem = {
  id: string;
  op: Op;
  createdAt: string;
  /** pending: not yet accepted by the server; error: the server refused it (kept, shown, retryable) */
  state: "pending" | "error";
  error?: string;
};

export type LocalDeal = {
  id: string;
  kind: "sale" | "buy" | "trade";
  occurredAt: string;
  eventId: string | null;
  /** money in minus money out */
  netCents: number;
  summary: string;
  voidedBy: string | null;
  synced: boolean;
  conflicts?: string[];
};

type Meta = { key: string; value: unknown };

class PosDb extends Dexie {
  units!: Table<PosUnit, string>;
  products!: Table<PosProduct, string>;
  outbox!: Table<OutboxItem, string>;
  deals!: Table<LocalDeal, string>;
  meta!: Table<Meta, string>;

  constructor() {
    super("nakama-pos");
    this.version(1).stores({
      units: "id, &code, status, productId",
      products: "id, name",
      outbox: "id, createdAt, state",
      deals: "id, occurredAt",
      meta: "key",
    });
  }
}

let instance: PosDb | null = null;
export function posDb(): PosDb {
  instance ??= new PosDb();
  return instance;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await posDb().meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await posDb().meta.put({ key, value });
}

export type LocalSettings = PosSnapshot["settings"] & { events: PosEvent[] };
