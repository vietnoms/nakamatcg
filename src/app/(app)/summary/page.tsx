import Link from "next/link";
import { Badge, Card, Stat } from "@/components/ui";
import { getDb } from "@/db/client";
import { formatCents } from "@/lib/money";
import { getSettings } from "@/server/settings";
import { eventDays, listEvents, summarize } from "@/server/summary";
import { EventControls } from "./event-controls";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { sale: "Sale", buy: "Buy", trade: "Trade" };

export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ event?: string; day?: string }> }) {
  const sp = await searchParams;
  const db = getDb();
  const tz = process.env.APP_TZ ?? "America/Los_Angeles";
  const [settings, events] = await Promise.all([getSettings(db), listEvents(db)]);
  const eventId = sp.event === "none" ? null : (sp.event ?? settings.activeEventId ?? events[0]?.id ?? null);
  const event = events.find((e) => e.id === eventId) ?? null;
  const days = await eventDays(db, eventId, tz);
  const day = sp.day && days.includes(sp.day) ? sp.day : undefined;
  const s = await summarize(db, {
    eventId,
    day,
    tz,
    methods: settings.paymentMethods,
    startingCashCents: event && !day ? event.startingCashCents : undefined,
  });
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" });
  const q = (o: { event?: string | null; day?: string }) => {
    const p = new URLSearchParams();
    p.set("event", o.event === undefined ? (eventId ?? "none") : (o.event ?? "none"));
    if (o.day) p.set("day", o.day);
    return `/summary?${p}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sales</h1>
          <p className="text-sm text-zinc-500">{event ? `${event.name}, ${event.startsOn} to ${event.endsOn}` : "Deals recorded without a show"}</p>
        </div>
        <EventControls events={events.map((e) => ({ id: e.id, name: e.name, startsOn: e.startsOn, startingCashCents: e.startingCashCents }))} activeId={settings.activeEventId} currentId={eventId} />
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={q({})} className={`rounded-full border px-3 py-1 ${!day ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300"}`}>
          Whole show
        </Link>
        {days.map((d) => (
          <Link key={d} href={q({ day: d })} className={`rounded-full border px-3 py-1 ${day === d ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300"}`}>
            {d}
          </Link>
        ))}
        <a href={`/api/export/sold?event=${eventId ?? "none"}${day ? `&day=${day}` : ""}`} className="ml-auto rounded-full border border-zinc-300 px-3 py-1">
          Export sold cards (CSV)
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sales" value={formatCents(s.revenueCents)} hint={`${s.cardsSold} cards`} />
        <Stat
          label="Gross profit"
          value={formatCents(s.profitCents)}
          hint={`cost ${formatCents(s.cogsCents)}, fees ${formatCents(s.feesCents)}${s.unknownCostLines ? `, ${s.unknownCostLines} with no cost` : ""}`}
        />
        <Stat label="Bought" value={formatCents(s.boughtCents)} hint={`${s.cardsBought} cards`} />
        <Stat label="Traded in" value={formatCents(s.tradeInCents)} hint={`${s.cardsTradedIn} cards`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="By payment method">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr>
                <th className="py-1">Method</th>
                <th className="py-1 text-right">In</th>
                <th className="py-1 text-right">Out</th>
                <th className="py-1 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {s.byMethod.map((m) => (
                <tr key={m.method} className="border-t border-zinc-100">
                  <td className="py-1.5">{m.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCents(m.inCents)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCents(m.outCents)}</td>
                  <td className="py-1.5 text-right font-medium tabular-nums">{formatCents(m.inCents - m.outCents)}</td>
                </tr>
              ))}
              {s.byMethod.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-zinc-500">
                    No payments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        {s.cashBoxCents !== null && event && (
          <Card title="Cash box">
            <p className="text-3xl font-semibold tabular-nums">{formatCents(s.cashBoxCents)}</p>
            <p className="mt-1 text-sm text-zinc-500">
              should be in the box: {formatCents(event.startingCashCents)} starting float, plus cash taken, minus cash paid out. Count it and compare.
            </p>
          </Card>
        )}
      </div>

      <Card title={`Deals (${s.deals.length})`}>
        <ul className="divide-y divide-zinc-100">
          {s.deals.map((d) => {
            const net = d.payments.reduce((n, p) => n + (p.direction === "in" ? p.amountCents : -p.amountCents), 0);
            return (
              <li key={d.id} className={`py-2 text-sm ${d.voided ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-2">
                  <Badge tone={d.kind === "sale" ? "green" : d.kind === "buy" ? "blue" : "amber"}>{KIND[d.kind] ?? d.kind}</Badge>
                  {d.voided && <Badge tone="red">voided</Badge>}
                  <span className="text-zinc-500">{time.format(d.occurredAt)}</span>
                  <span className="ml-auto tabular-nums">
                    {d.payments.map((p) => `${settings.paymentMethods.find((m) => m.id === p.method)?.label ?? p.method} ${p.direction === "out" ? "-" : ""}${formatCents(p.amountCents)}`).join(" + ") || "no money"}
                  </span>
                  <span className={`w-24 text-right font-medium tabular-nums ${net >= 0 ? "text-green-700" : "text-red-700"}`}>{formatCents(net)}</span>
                </div>
                <ul className="mt-1 pl-2 text-xs text-zinc-600">
                  {d.lines.map((l, i) => (
                    <li key={i}>
                      {l.direction === "out" ? "out" : "in"}: {l.name} {l.detail && <span className="text-zinc-400">{l.detail}</span>}{" "}
                      {l.code && <span className="font-mono text-zinc-400">{l.code}</span>} {formatCents(l.amountCents)}
                      {l.direction === "out" && l.stickerCents !== null && l.stickerCents !== l.amountCents && <span className="text-zinc-400"> (sticker {formatCents(l.stickerCents)})</span>}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
          {s.deals.length === 0 && <li className="py-6 text-center text-sm text-zinc-500">No deals yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
