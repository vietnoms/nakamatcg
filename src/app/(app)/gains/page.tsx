import { Explainer } from "@/components/explainer";
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
      <h1 className="text-2xl font-semibold">Gain and loss</h1>
      <Explainer id="gains" title="How gain and loss are worked out">
        <ul>
          <li>
            <b>In stock (unrealized)</b>: the latest Collectr market price minus what each copy cost you. It changes every time you
            import a fresh CSV. Copies of one card bought at different prices get their own rows.
          </li>
          <li>
            <b>Sold (realized)</b>: what each card actually brought in minus its cost. In a bundle, the agreed total is split across
            the cards by their sticker prices; in a trade, your card counts at the value you gave it.
          </li>
          <li>
            Cards with <b>no cost</b> (Collectr shows 0) or no market price are counted but left out of the totals. Add the cost in
            Collectr and re-import to include them.
          </li>
          <li>Click a column to sort; click again to flip. <b>Export CSV</b> gives the current tab for your P&amp;L.</li>
        </ul>
      </Explainer>
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
