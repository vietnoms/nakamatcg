import "server-only";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { units } from "@/db/schema";
import type { ProductInput } from "@/lib/ops";
import { freshCodes } from "./import";
import { productFor } from "./ops";

export type AddStockInput = {
  product: ProductInput;
  qty: number;
  /** what each copy cost me; null when unknown */
  costCents: number | null;
  /** price each, or null to price later on the Pricing page */
  priceCents: number | null;
  groupId: string | null;
};

/**
 * Stock that came in outside a show and outside Collectr (sealed from a distributor, a store
 * buy): one unit per copy with a fresh code, ready to price and, unless sealed, to sticker.
 */
export async function addStock(db: Db, input: AddStockInput): Promise<{ productId: string; codes: string[] }> {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const productId = await productFor(tx, input.product);
    if (input.product.marketCents !== null) {
      // the catalog's price is newer than whatever the product had
      await tx.execute(sql`update products set market_cents = ${input.product.marketCents}, market_updated_at = now(), updated_at = now() where id = ${productId}`);
    }
    const codes = await freshCodes(tx, input.qty);
    await tx.insert(units).values(
      codes.map((code) => ({ code, productId, costCents: input.costCents, priceCents: input.priceCents, source: "manual", groupId: input.groupId })),
    );
    return { productId, codes };
  });
}
