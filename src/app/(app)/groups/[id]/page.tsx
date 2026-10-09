import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Stat } from "@/components/ui";
import { getDb } from "@/db/client";
import { bpsToPercent } from "@/lib/consignment";
import { formatCents } from "@/lib/money";
import { consignmentReport, getGroup, groupUnits, listGroups } from "@/server/groups";
import { GroupForm } from "../group-form";
import { UnitsTable } from "./units-table";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function GroupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const loose = id === "none";
  if (!loose && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const group = loose ? null : await getGroup(db, id);
  if (!loose && !group) notFound();

  const tz = process.env.APP_TZ ?? "America/Los_Angeles";
  const from = sp.from && DAY.test(sp.from) ? sp.from : undefined;
  const to = sp.to && DAY.test(sp.to) ? sp.to : undefined;
  const [cards, all, report] = await Promise.all([
    groupUnits(db, group?.id ?? null),
    listGroups(db),
    group?.kind === "consignment" ? consignmentReport(db, group, { from, to, tz }) : Promise.resolve(null),
  ]);
  const inStock = cards.filter((c) => c.status === "in_stock");
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" });
  const exportHref = group ? `/api/export/consignment?group=${group.id}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}` : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/groups" className="text-sm text-zinc-500 underline dark:text-zinc-400">
          Groups
        </Link>
        <h1 className="text-2xl font-semibold">{group?.name ?? "No group"}</h1>
        {group?.kind === "personal" && <Badge tone="blue">PC, not for sale</Badge>}
        {group?.kind === "consignment" && (
          <Badge tone="amber">
            Consignment, {bpsToPercent(group.feeBps ?? 0)}% fee{group.minFeeCents ? `, at least ${formatCents(group.minFeeCents)} a card` : ""}
          </Badge>
        )}
      </div>

      {report && group && (
        <Card title="What sold and what you owe">
          <form className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5">
              From
              <input type="date" name="from" defaultValue={from} className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <label className="flex items-center gap-1.5">
              to
              <input type="date" name="to" defaultValue={to} className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <button className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700">Show</button>
            {(from || to) && (
              <Link href={`/groups/${group.id}`} className="text-zinc-500 underline dark:text-zinc-400">
                All time
              </Link>
            )}
            <a href={exportHref} className="ml-auto rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700">
              Download statement (CSV)
            </a>
          </form>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Cards sold" value={report.totals.cards} hint={from || to ? `${from ?? "start"} to ${to ?? "today"}` : "all time"} />
            <Stat label="Sold for" value={formatCents(report.totals.soldCents)} />
            <Stat label="Your fee" value={formatCents(report.totals.feeCents)} />
            <Stat label={`Owed to ${group.name}`} value={formatCents(report.totals.payoutCents)} />
          </div>
          {report.sales.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                  <tr>
                    <th className="py-1.5">Date</th>
                    <th className="py-1.5">Card</th>
                    <th className="py-1.5 text-right">Sticker</th>
                    <th className="py-1.5 text-right">Sold for</th>
                    <th className="py-1.5 text-right">Fee</th>
                    <th className="py-1.5 text-right">Owed</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sales.map((s) => (
                    <tr key={`${s.transactionId}-${s.code}`} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5 whitespace-nowrap">
                        {day.format(s.occurredAt)}
                        {s.how === "traded" && <span className="text-zinc-500 dark:text-zinc-400"> (trade)</span>}
                      </td>
                      <td className="py-1.5">
                        <span className="font-mono text-xs">{s.code}</span> {s.name} <span className="text-zinc-500 dark:text-zinc-400">{s.badge}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{s.stickerCents === null ? "-" : formatCents(s.stickerCents)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCents(s.soldCents)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCents(s.feeCents)}</td>
                      <td className="py-1.5 text-right font-medium tabular-nums">{formatCents(s.payoutCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing of theirs sold{from || to ? " in these dates" : " yet"}.</p>
          )}
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            A card sold in a bundle counts at its share of the bundle price; one traded away counts at the value you gave it in the trade.
            Voided deals are left out. Pick dates to settle up for one show or one month.
          </p>
        </Card>
      )}

      <Card title={`Cards (${inStock.length} in stock${cards.length > inStock.length ? `, ${cards.length - inStock.length} gone` : ""})`}>
        <UnitsTable units={cards} groups={all.flatMap((g) => (g.id ? [{ id: g.id, name: g.name }] : []))} currentId={group?.id ?? null} />
      </Card>

      {group && (
        <Card title="Group settings">
          <GroupForm id={group.id} initial={{ name: group.name, kind: group.kind, feeBps: group.feeBps, minFeeCents: group.minFeeCents, note: group.note }} />
        </Card>
      )}
    </div>
  );
}
