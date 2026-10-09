"use server";

// No revalidatePath: every page here renders fresh on each load, and a refresh mid-pricing
// would re-filter the table under the cursor.
import { z } from "zod";
import { requireSession } from "@/auth/guard";
import { getDb } from "@/db/client";
import { moveProductToPersonal } from "@/server/groups";
import { setProductPrice, setProductPrices } from "@/server/inventory";

const Cents = z.number().int().min(0).max(100_000_000);

export async function savePrice(productId: string, priceCents: number | null): Promise<void> {
  await requireSession();
  await setProductPrice(getDb(), z.string().uuid().parse(productId), Cents.nullable().parse(priceCents));
}

export async function savePrices(prices: { productId: string; priceCents: number }[]): Promise<void> {
  await requireSession();
  const parsed = z.array(z.object({ productId: z.string().uuid(), priceCents: Cents })).max(20_000).parse(prices);
  await setProductPrices(getDb(), parsed);
}

/** Takes my copies of a card off sale, into the personal collection (PC). */
export async function moveToPc(productId: string): Promise<{ moved: number; groupId: string }> {
  await requireSession();
  return moveProductToPersonal(getDb(), z.string().uuid().parse(productId));
}
