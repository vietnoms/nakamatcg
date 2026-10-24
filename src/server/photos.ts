import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { dealPhotos, transactions } from "@/db/schema";

/** A photo bigger than this was not shrunk on the phone; refuse it rather than fill the database. */
export const MAX_PHOTO_BYTES = 3_000_000;

export type SavePhoto = { id: string; dealId: string; takenAt: Date; mime: string; bytes: Uint8Array };

/**
 * Stores a deal photo. Idempotent on the phone-made id (a retried upload is a no-op). "no-deal"
 * means the deal has not synced yet; the phone keeps the photo and tries again later.
 */
export async function savePhoto(db: Db, p: SavePhoto): Promise<"saved" | "duplicate" | "no-deal"> {
  const [deal] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, p.dealId));
  if (!deal) return "no-deal";
  const rows = await db
    .insert(dealPhotos)
    .values({ id: p.id, transactionId: p.dealId, takenAt: p.takenAt, mime: p.mime, size: p.bytes.byteLength, bytes: p.bytes })
    .onConflictDoNothing({ target: dealPhotos.id })
    .returning({ id: dealPhotos.id });
  return rows.length ? "saved" : "duplicate";
}

export async function getPhoto(db: Db, id: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const [row] = await db.select({ mime: dealPhotos.mime, bytes: dealPhotos.bytes }).from(dealPhotos).where(eq(dealPhotos.id, id));
  return row ?? null;
}

/** Photo ids per deal, in the order they were taken. */
export async function photoIds(db: Db, dealIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (dealIds.length === 0) return out;
  const rows = await db
    .select({ id: dealPhotos.id, dealId: dealPhotos.transactionId })
    .from(dealPhotos)
    .where(inArray(dealPhotos.transactionId, dealIds))
    .orderBy(asc(dealPhotos.takenAt));
  for (const r of rows) out.set(r.dealId, [...(out.get(r.dealId) ?? []), r.id]);
  return out;
}
