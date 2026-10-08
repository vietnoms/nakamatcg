"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/auth/guard";
import { getDb } from "@/db/client";
import { normalizeCode } from "@/lib/codes";
import { inArray } from "drizzle-orm";
import { units } from "@/db/schema";
import { markPrinted, requestReprint } from "@/server/inventory";

const Ids = z.array(z.string().uuid()).max(5000);

export async function markPrintedAction(unitIds: string[]): Promise<number> {
  await requireSession();
  const n = await markPrinted(getDb(), Ids.parse(unitIds));
  revalidatePath("/");
  return n;
}

/** Puts units back in the queue by sticker code, for a damaged or lost sticker. */
export async function reprintCodes(text: string): Promise<{ queued: number; unknown: string[] }> {
  await requireSession();
  const raw = z.string().max(20_000).parse(text).split(/[\s,]+/).filter(Boolean);
  const codes = raw.map((c) => normalizeCode(c));
  const valid = codes.filter((c): c is string => c !== null);
  const db = getDb();
  const found = valid.length ? await db.select({ id: units.id, code: units.code }).from(units).where(inArray(units.code, valid)) : [];
  await requestReprint(db, found.map((f) => f.id));
  const known = new Set(found.map((f) => f.code));
  revalidatePath("/labels");
  return { queued: found.length, unknown: raw.filter((_, i) => !codes[i] || !known.has(codes[i]!)) };
}
