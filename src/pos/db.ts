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

/**
 * A photo of a deal. "cart": taken for the cart being built; "pending": its deal is recorded and the
 * photo waits to upload (after the deal itself syncs); "done": on the server (the bytes are dropped here).
 */
export type LocalPhoto = {
  id: string;
  /** the draft (cart) it was taken for; stays with the draft if the cart is put aside */
  draftId: string | null;
  dealId: string | null;
  blob: Blob | null;
  takenAt: string;
  state: "cart" | "pending" | "done";
};

/**
 * Every cart is kept as a draft from its first item, finished or not, so it can be looked at or
 * picked up again later. "open": the cart on screen; "parked": put aside for later; "abandoned":
 * cleared without confirming. A confirmed cart's draft is dropped (the deal is in History).
 */
export type LocalDraft = {
  id: string;
  state: "open" | "parked" | "abandoned";
  createdAt: string;
  updatedAt: string;
  outIds: string[];
  misc: { key: string; description: string; amountCents: number }[];
  items: unknown[];
  agreed: number | null;
  summary: string;
  /** money as it stood: positive they pay, negative I pay */
  settleCents: number;
};

type Meta = { key: string; value: unknown };

class PosDb extends Dexie {
  units!: Table<PosUnit, string>;
  products!: Table<PosProduct, string>;
  outbox!: Table<OutboxItem, string>;
  deals!: Table<LocalDeal, string>;
  meta!: Table<Meta, string>;
  photos!: Table<LocalPhoto, string>;
  drafts!: Table<LocalDraft, string>;

  constructor() {
    super("nakama-pos");
    this.version(1).stores({
      units: "id, &code, status, productId",
      products: "id, name",
      outbox: "id, createdAt, state",
      deals: "id, occurredAt",
      meta: "key",
    });
    // v2: photos of deals (kept until uploaded) and drafts of every cart
    this.version(2).stores({ photos: "id, draftId, dealId, state", drafts: "id, updatedAt, state" });
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
