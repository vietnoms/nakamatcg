"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/auth/guard";
import { getDb } from "@/db/client";
import { ProductInput } from "@/lib/ops";
import { identifyUnit, resplitByMarket } from "@/server/intake";

const Cents = z.number().int().min(0).max(100_000_000);

export async function identifyAction(unitId: string, product: z.input<typeof ProductInput>, priceCents: number | null): Promise<void> {
  await requireSession();
  await identifyUnit(getDb(), z.string().uuid().parse(unitId), ProductInput.parse(product), Cents.nullable().parse(priceCents));
  revalidatePath("/", "layout");
}

export async function resplitAction(dealId: string): Promise<number> {
  await requireSession();
  const n = await resplitByMarket(getDb(), z.string().uuid().parse(dealId));
  revalidatePath("/intake");
  return n;
}
