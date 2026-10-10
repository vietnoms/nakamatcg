"use server";

// No revalidatePath: every page here renders fresh on each load, and a refresh mid-pricing
// would re-filter the table under the cursor.
import { z } from "zod";
import { requireSession } from "@/auth/guard";
import { getDb } from "@/db/client";
import { moveProductToPersonal, parseGroupParam } from "@/server/groups";
import { changeCondition } from "@/server/condition";
import { pricingRows, setProductPrice, setProductPrices, type PricingRow } from "@/server/inventory";
import { CONDITIONS } from "@/lib/condition";

const Cents = z.number().int().min(0).max(100_000_000);

/** `group` is the page's ?group= value: a price set in a group view applies to that group's copies only. */
export async function savePrice(productId: string, priceCents: number | null, group = ""): Promise<void> {
  await requireSession();
  await setProductPrice(getDb(), z.string().uuid().parse(productId), Cents.nullable().parse(priceCents), parseGroupParam(group));
}

export async function savePrices(prices: { productId: string; priceCents: number }[], group = ""): Promise<void> {
  await requireSession();
  const parsed = z.array(z.object({ productId: z.string().uuid(), priceCents: Cents })).max(20_000).parse(prices);
  await setProductPrices(getDb(), parsed, parseGroupParam(group));
}

/** Takes my copies of a card off sale, into the personal collection (PC). */
export async function moveToPc(productId: string, group = ""): Promise<{ moved: number; groupId: string }> {
  await requireSession();
  return moveProductToPersonal(getDb(), z.string().uuid().parse(productId), parseGroupParam(group));
}

/** Changes the condition of every copy of a card in view; returns the card's row in its new condition. */
export async function setCondition(productId: string, condition: string, group = ""): Promise<{ moved: number; row: PricingRow | null; estimated: boolean }> {
  await requireSession();
  const db = getDb();
  const g = parseGroupParam(group);
  const res = await changeCondition(db, { productId: z.string().uuid().parse(productId), group: g }, z.enum(CONDITIONS).parse(condition));
  const row = res.productId ? ((await pricingRows(db, { group: g })).find((r) => r.productId === res.productId) ?? null) : null;
  return { moved: res.moved, row, estimated: res.estimated };
}
