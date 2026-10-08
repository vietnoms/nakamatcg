import clsx from "clsx";
import Link from "next/link";
import { Stat } from "@/components/ui";
import { getDb } from "@/db/client";
import { formatCents } from "@/lib/money";
import { inventoryCounts } from "@/server/inventory";
import { getSettings } from "@/server/settings";
import { listEvents } from "@/server/summary";

export const dynamic = "force-dynamic";

type Step = { done: boolean; title: string; href: string; action: string; detail: string };

export default async function Home() {
  const db = getDb();
  const [c, settings, events] = await Promise.all([inventoryCounts(db), getSettings(db), listEvents(db)]);
  const active = events.find((e) => e.id === settings.activeEventId);

  const steps: Step[] = [
    {
      done: c.inStock > 0,
      title: "Import your Collectr portfolio",
      href: "/import",
      action: "Import",
      detail: "Export CSV in Collectr, choose the portfolios you are bringing. Each copy gets its own sticker code.",
    },
    {
      done: c.inStock > 0 && c.unpriced === 0,
      title: "Price every card",
      href: "/pricing",
      action: c.unpriced ? `Price ${c.unpriced}` : "Pricing",
      detail: "Type a price and press Enter, or press Enter on an empty box to take the suggested price.",
    },
    {
      done: c.inStock > 0 && c.unpriced === 0 && c.needLabels === 0,
      title: "Print the stickers",
      href: "/labels",
      action: c.needLabels ? `Print ${c.needLabels}` : "Stickers",
      detail: "On the laptop with the Zebra. Print one test sticker and scan it with your phone first.",
    },
    {
      done: Boolean(active),
      title: "Set up the show",
      href: "/summary",
      action: active ? active.name : "New show",
      detail: "Sales > New show: name, dates, and the cash you start with. Phones file every sale under it.",
    },
    {
      done: false,
      title: "Get the phone ready",
      href: "/pos",
      action: "Open POS",
      detail: "Open the POS on your phone while online, add it to the home screen, open it from the icon, and wait for “Offline ready”.",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Nakama Cards</h1>
        <p className="mt-1 text-sm text-zinc-500">Inventory, price stickers, and show sales in one place.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="In stock" value={c.inStock} hint={`${c.sold} sold so far`} />
        <Stat label="Unpriced" value={c.unpriced} hint={c.unpriced ? <Link className="underline" href="/pricing">Price them</Link> : "All priced"} />
        <Stat label="Stickers to print" value={c.needLabels} hint={c.needLabels ? <Link className="underline" href="/labels">Print</Link> : "Up to date"} />
        <Stat label="Stock at sticker price" value={formatCents(c.stockValueCents)} />
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white">
        <h2 className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold">Before a show</h2>
        <ol>
          {steps.map((s, i) => (
            <li key={s.title} className="flex items-start gap-3 border-b border-zinc-100 px-4 py-3 last:border-0">
              <span
                className={clsx(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  s.done ? "bg-green-600 text-white" : "bg-zinc-200 text-zinc-700",
                )}
              >
                {s.done ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className={clsx("text-sm font-medium", s.done && "text-zinc-500")}>{s.title}</div>
                <div className="text-xs text-zinc-500">{s.detail}</div>
              </div>
              <Link href={s.href} prefetch={s.href === "/pos" ? false : undefined} className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50">
                {s.action}
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {[
          { href: "/pos", title: "POS (phone)", text: "Scan sticker QR codes into a cart, take payment, buy and trade cards. Works with no signal and syncs later." },
          { href: "/summary", title: "Sales", text: "Totals per show and day, money by payment method, what should be in the cash box, and every deal." },
          { href: "/gains", title: "Gain and loss", text: "Every card against what it cost you: in stock at today's market price, sold at what it brought in. Exports for your P&L." },
          { href: "/labels", title: "Stickers", text: "Print new stickers, reprint changed prices or damaged stickers by code." },
        ].map((f) => (
          <Link key={f.href} href={f.href} prefetch={f.href === "/pos" ? false : undefined} className="rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-400">
            <div className="text-sm font-semibold">{f.title}</div>
            <p className="mt-1 text-sm text-zinc-600">{f.text}</p>
          </Link>
        ))}
      </section>

      <p className="text-xs text-zinc-500">
        Phone battery or signal trouble at the show? Print the <Link className="underline" href="/inventory/print">paper backup list</Link> beforehand.
      </p>
    </div>
  );
}
