import { getDb } from "@/db/client";
import { realizedGains, unrealizedGains } from "@/server/gains";
import { GainsView } from "./gains-view";

export const dynamic = "force-dynamic";

export default async function GainsPage() {
  const db = getDb();
  const tz = process.env.APP_TZ ?? "America/Los_Angeles";
  const [unrealized, realized] = await Promise.all([unrealizedGains(db), realizedGains(db)]);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  const asOf = unrealized.marketAsOf ? new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "medium" }).format(unrealized.marketAsOf) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Gain and loss</h1>
        <p className="mt-1 text-sm text-zinc-500">
          In stock: today&apos;s market price against what each copy cost you (unrealized). Sold: what each card brought in
          against its cost (realized; a bundle&apos;s price is split by sticker price). Click a column to sort; export either
          view as CSV for your P&amp;L.
        </p>
      </div>
      <GainsView
        unrealized={unrealized.rows}
        unknownCost={unrealized.unknownCost}
        noMarket={unrealized.noMarket}
        marketAsOf={asOf}
        realized={realized.map(({ occurredAt, ...r }) => ({ ...r, soldOn: day.format(occurredAt) }))}
      />
    </div>
  );
}
