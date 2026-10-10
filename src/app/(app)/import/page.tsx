import { Explainer } from "@/components/explainer";
import { getDb } from "@/db/client";
import { listGroups } from "@/server/groups";
import { getSettings } from "@/server/settings";
import { AddStock } from "./add-stock";
import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const db = getDb();
  const [groups, settings] = await Promise.all([listGroups(db), getSettings(db)]);
  const consignors = groups.flatMap((g) => (g.id && g.kind === "consignment" ? [{ id: g.id, name: g.name, feeBps: g.feeBps ?? 0 }] : []));
  const mine = groups.flatMap((g) => (g.id && g.kind !== "consignment" ? [{ id: g.id, name: g.name }] : []));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Import and add stock</h1>
      <Explainer id="import" title="How importing works">
        <ol>
          <li>In Collectr, export your portfolio as CSV (it downloads as something like &ldquo;collectr port.csv&rdquo;).</li>
          <li>Drop the file below. The columns are matched by name; fix any that are wrong.</li>
          <li>Untick portfolios you are not bringing (a personal collection, cards in the PSA vault). Your choice is remembered for next time.</li>
          <li>Press <b>Preview</b> to see what would change, then <b>Import</b>. Nothing is saved before that.</li>
        </ol>
        <p>
          <b>Each physical copy becomes one item with its own sticker code</b>, so 3 copies of a card get 3 stickers. Your
          Collectr cost comes along for the gain and loss page; a cost Collectr shows as 0 counts as unknown, and a Price
          Override you set in Collectr is used as the market price.
        </p>
        <p>
          <b>Display portfolio with no costs?</b> If you scanned cards into a new portfolio that you already own in another one,
          export everything, leave the other portfolio <b>unticked</b>, and import: each copy with no cost takes what you paid for
          the same card there (same condition first, then any condition), one copy each. Re-importing fills copies imported earlier too.
        </p>
        <p>
          <b>A vending portfolio?</b> Scan the cards you are bringing into a new Collectr portfolio, export, untick your main
          portfolio, and tick <b>Move cards I already have</b>: each card moves from its group here into the new portfolio&apos;s group
          with its cost, instead of being added twice. Cards it can&apos;t find (never imported, or in your PC) are added or left alone.
        </p>
        <p>
          <b>Bought someone&apos;s whole collection?</b> Drop their Collectr CSV, pick <b>Bought as a lot</b> and the percentage you
          paid (say 70%): every new copy costs that share of its market price today, so gain and loss starts from what you paid.
        </p>
        <p>
          <b>Importing again later is safe.</b> It updates market prices (that is how stale stickers get spotted) and only adds
          copies that are new. Cards you sold here are never added back, even if they are still in Collectr.
        </p>
        <p>
          <b>Groups</b>: each portfolio becomes a group of the same name (see the Groups page). <b>Consigning for someone?</b> Choose
          &ldquo;A consignor&apos;s cards&rdquo; and drop their Collectr CSV: their cards go in their own group with your fee, kept
          apart from yours.
        </p>
      </Explainer>
      <ImportClient consignors={consignors} />
      <AddStock groups={mine} rule={settings.pricing} />
    </div>
  );
}
