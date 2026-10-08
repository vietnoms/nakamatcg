import { Explainer } from "@/components/explainer";
import { getDb } from "@/db/client";
import { listGroups } from "@/server/groups";
import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const consignors = (await listGroups(getDb())).flatMap((g) => (g.id && g.kind === "consignment" ? [{ id: g.id, name: g.name, feeBps: g.feeBps ?? 0 }] : []));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Import from Collectr</h1>
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
    </div>
  );
}
