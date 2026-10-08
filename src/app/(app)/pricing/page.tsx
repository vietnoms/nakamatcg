import Link from "next/link";
import { getDb } from "@/db/client";
import { pricingRows } from "@/server/inventory";
import { getSettings } from "@/server/settings";
import { PricingTable } from "./pricing-table";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const db = getDb();
  const [rows, settings] = await Promise.all([pricingRows(db), getSettings(db)]);
  const r = settings.pricing;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Pricing</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Suggested = {r.percent}% of market, rounded {r.mode === "nearest" ? "to the nearest" : r.mode} step (
          <Link href="/settings" className="underline">
            change
          </Link>
          ). Type a price and press Enter to save and move on; Enter on an empty box takes the suggestion. A price applies
          to every copy of that card in stock.
        </p>
      </div>
      <PricingTable rows={rows} rule={r} />
    </div>
  );
}
