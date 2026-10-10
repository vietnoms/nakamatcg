import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { products, units } from "@/db/schema";
import { badgeFor, type ProductKind } from "@/import/collectr";
import { formatCents } from "@/lib/money";
import { GroupPicker } from "@/components/group-picker";
import { forSale, inGroup, listGroups, parseGroupParam } from "@/server/groups";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/** Paper fallback for the show: every in-stock card with its code and price. */
export default async function PrintInventory({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const db = getDb();
  const group = parseGroupParam((await searchParams).group);
  const groups = await listGroups(db);
  const picked = group === undefined ? null : (groups.find((g) => g.id === group) ?? null);
  const rows = await db
    .select({
      code: units.code,
      priceCents: units.priceCents,
      kind: products.kind,
      name: products.name,
      setName: products.setName,
      cardNumber: products.cardNumber,
      condition: products.condition,
      grader: products.grader,
      grade: products.grade,
    })
    .from(units)
    .innerJoin(products, eq(products.id, units.productId))
    .where(and(eq(units.status, "in_stock"), forSale, inGroup(group)))
    .orderBy(asc(units.code));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-semibold">Inventory list ({rows.length})</h1>
        <div className="flex items-center gap-2">
          <GroupPicker groups={groups.filter((g) => g.id !== null && g.kind !== "personal").map((g) => ({ id: g.id!, name: g.name }))} noneOption={groups.some((g) => g.id === null)} />
          <PrintButton />
        </div>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 print:hidden">Sorted by sticker code. Print it before the show in case the phone dies; write sales on the back.</p>
      {picked && <p className="hidden text-sm font-semibold print:block">{picked.name}</p>}
      <table className="w-full text-xs">
        <thead className="text-left">
          <tr className="border-b border-zinc-400 dark:border-zinc-500">
            <th className="py-1">Code</th>
            <th className="py-1">Card</th>
            <th className="py-1">Set</th>
            <th className="py-1">Cond.</th>
            <th className="py-1 text-right">Price</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-b border-zinc-200 dark:border-zinc-800 break-inside-avoid">
              <td className="py-0.5 font-mono">{r.code}</td>
              <td className="py-0.5">{r.name}</td>
              <td className="py-0.5">{[r.setName, r.cardNumber && `#${r.cardNumber}`].filter(Boolean).join(" ")}</td>
              <td className="py-0.5">{badgeFor({ kind: r.kind as ProductKind, condition: r.condition, grader: r.grader, grade: r.grade })}</td>
              <td className="py-0.5 text-right tabular-nums">{r.priceCents === null ? "" : formatCents(r.priceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
