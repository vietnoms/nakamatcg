import Link from "next/link";
import { Card, Stat } from "@/components/ui";
import { getDb } from "@/db/client";
import { formatCents } from "@/lib/money";
import { inventoryCounts } from "@/server/inventory";

export const dynamic = "force-dynamic";

export default async function Home() {
  const c = await inventoryCounts(getDb());
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Inventory</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="In stock" value={c.inStock} />
        <Stat label="Unpriced" value={c.unpriced} hint={c.unpriced ? <Link className="underline" href="/pricing">Price them</Link> : "All priced"} />
        <Stat label="Stickers to print" value={c.needLabels} hint={c.needLabels ? <Link className="underline" href="/labels">Print</Link> : "Up to date"} />
        <Stat label="Stock at sticker price" value={formatCents(c.stockValueCents)} />
      </div>
      <Card title="Before a show">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm">
          <li>
            <Link className="underline" href="/import">Import</Link> a fresh Collectr CSV (new cards and market prices).
          </li>
          <li>
            <Link className="underline" href="/pricing">Price</Link> what is new or changed. Enter accepts the suggestion.
          </li>
          <li>
            <Link className="underline" href="/labels">Print stickers</Link> on the Zebra and put them on the sleeves.
          </li>
          <li>
            Open <Link className="underline" href="/pos">POS</Link> on your phone, add it to the home screen, and wait for &ldquo;Offline ready&rdquo;.
          </li>
        </ol>
      </Card>
    </div>
  );
}
