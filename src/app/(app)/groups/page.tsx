import Link from "next/link";
import { Explainer } from "@/components/explainer";
import { Badge, Card } from "@/components/ui";
import { getDb } from "@/db/client";
import { bpsToPercent } from "@/lib/consignment";
import { formatCents } from "@/lib/money";
import { listGroups } from "@/server/groups";
import { GroupForm } from "./group-form";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const groups = await listGroups(getDb());
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Groups</h1>
      <Explainer id="groups" title="How groups work">
        <ul>
          <li>
            Every card can sit in a <b>group</b>. Importing from Collectr makes one group per portfolio, named like the portfolio,
            and puts each copy in it. Cards imported before groups existed get their group the next time you import the same file.
          </li>
          <li>Open a group to see its cards, tick some, and move them to another group.</li>
          <li>
            <b>Consignment</b>: cards you sell for someone else. Make a consignment group with your fee, then on the Import page
            choose <b>A consignor&apos;s cards</b> and drop their Collectr CSV. Their cards are kept apart from yours (no cost, not in
            your gain and loss), sell like any other card, and the group page shows what sold, your fee, and what you owe them.
          </li>
        </ul>
      </Explainer>

      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="py-1.5">Group</th>
              <th className="py-1.5">Type</th>
              <th className="py-1.5 text-right">In stock</th>
              <th className="hidden py-1.5 text-right sm:table-cell">Stock value</th>
              <th className="py-1.5 text-right">Sold</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-zinc-500 dark:text-zinc-400">
                  No groups yet. Import a Collectr CSV, or make one below.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <tr key={g.id ?? "none"} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-2">
                  <Link href={`/groups/${g.id ?? "none"}`} className="font-medium underline-offset-2 hover:underline">
                    {g.name}
                  </Link>
                </td>
                <td className="py-2">
                  {g.id === null ? (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">not grouped</span>
                  ) : g.kind === "consignment" ? (
                    <Badge tone="amber">Consignment {bpsToPercent(g.feeBps ?? 0)}%</Badge>
                  ) : (
                    <Badge>Mine</Badge>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">{g.inStock}</td>
                <td className="hidden py-2 text-right tabular-nums sm:table-cell">{formatCents(g.stockValueCents)}</td>
                <td className="py-2 text-right tabular-nums">{g.sold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="New group">
        <GroupForm />
      </Card>
    </div>
  );
}
