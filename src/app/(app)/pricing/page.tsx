import Link from "next/link";
import { Explainer } from "@/components/explainer";
import { getDb } from "@/db/client";
import { formatCents } from "@/lib/money";
import { pricingRows } from "@/server/inventory";
import { getSettings } from "@/server/settings";
import { PricingTable } from "./pricing-table";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const db = getDb();
  const [rows, settings] = await Promise.all([pricingRows(db), getSettings(db)]);
  const r = settings.pricing;
  const steps = r.tiers
    .map((t, i) => {
      const from = i === 0 ? null : r.tiers[i - 1]!.belowCents;
      const range = t.belowCents === null ? `from ${formatCents(from ?? 0)}` : from === null ? `under ${formatCents(t.belowCents)}` : `${formatCents(from)} to ${formatCents(t.belowCents)}`;
      return `${range}: ${formatCents(t.stepCents)} steps`;
    })
    .join("; ");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Pricing</h1>
      <Explainer id="pricing" title="How pricing works">
        <p>
          <b>Suggested price</b> = {r.percent}% of the Collectr market price, rounded {r.mode === "nearest" ? "to the nearest" : r.mode} step ({steps}),
          never under {formatCents(r.minCents)}. <Link href="/settings" className="underline">Change the rule in Settings</Link>.
        </p>
        <ul>
          <li>Type a price and press <b>Enter</b>: it saves and jumps to the next card. <b>Enter on an empty box</b> takes the suggestion. Arrow keys move up and down; Esc undoes a typo.</li>
          <li>A price applies to <b>every copy</b> of that card in stock, and puts their stickers in the print queue.</li>
          <li>The small % under a price is how it compares to market, so a typo like $1,350 for a $13.50 card stands out.</li>
          <li><b>Accept suggested</b> prices every unpriced card in the current view at once; filter first (one set, raw only) to keep control.</li>
        </ul>
      </Explainer>
      <PricingTable rows={rows} rule={r} />
    </div>
  );
}
