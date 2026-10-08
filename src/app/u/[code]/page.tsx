import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui";
import { getDb } from "@/db/client";
import { badgeFor } from "@/import/collectr";
import { normalizeCode } from "@/lib/codes";
import { formatCents } from "@/lib/money";
import { unitByCode } from "@/server/inventory";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "green" | "red" | "zinc" | "amber" }> = {
  in_stock: { label: "In stock", tone: "green" },
  sold: { label: "Sold", tone: "red" },
  traded_out: { label: "Traded away", tone: "amber" },
  removed: { label: "Removed", tone: "zinc" },
};

/** Where a sticker's QR code leads when scanned with the phone's own camera app. */
export default async function UnitPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const code = normalizeCode((await params).code);
  if (!code) notFound();
  const u = await unitByCode(getDb(), code);
  if (!u) notFound();
  // scanned with the phone's camera app: put the card straight into the POS cart (?view=1 shows this page instead)
  if (u.status === "in_stock" && (await searchParams).view !== "1") redirect(`/pos?add=${u.code}`);
  const status = STATUS[u.status] ?? { label: u.status, tone: "zinc" as const };
  const badge = badgeFor(u);

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-zinc-500 dark:text-zinc-400">{u.code}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div>
        <h1 className="text-2xl font-semibold">{u.name}</h1>
        <p className="text-zinc-500 dark:text-zinc-400">
          {[u.setName, u.cardNumber && `#${u.cardNumber}`, u.variant].filter(Boolean).join(" · ")} {badge && <Badge>{badge}</Badge>}
        </p>
        {u.cert && <p className="text-sm text-zinc-500 dark:text-zinc-400">Cert {u.cert}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Price</dt>
          <dd className="text-2xl font-semibold">{u.priceCents === null ? "-" : formatCents(u.priceCents)}</dd>
          {u.stickeredPriceCents !== null && u.stickeredPriceCents !== u.priceCents && (
            <dd className="text-xs text-amber-700 dark:text-amber-300">Sticker says {formatCents(u.stickeredPriceCents)}</dd>
          )}
        </div>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Market</dt>
          <dd className="text-2xl font-semibold">{u.marketCents === null ? "-" : formatCents(u.marketCents)}</dd>
          {u.costCents !== null && <dd className="text-xs text-zinc-500 dark:text-zinc-400">Cost {formatCents(u.costCents)}</dd>}
        </div>
      </dl>
      {u.status === "in_stock" && (
        <Link href={`/pos?add=${u.code}`} className="block rounded-md bg-zinc-900 dark:bg-zinc-100 py-3 text-center font-medium text-white dark:text-zinc-950">
          Sell in POS
        </Link>
      )}
    </main>
  );
}
