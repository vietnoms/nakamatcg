"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { Badge, Input, Select, Stat } from "@/components/ui";
import { formatCents } from "@/lib/money";
import type { RealizedRow, UnrealizedRow } from "@/server/gains";

type Realized = Omit<RealizedRow, "occurredAt"> & { soldOn: string };
type Dir = "asc" | "desc";

const money = (c: number | null) => (c === null ? "-" : formatCents(c));
const pct = (p: number | null) => (p === null ? "-" : `${p > 0 ? "+" : ""}${p.toFixed(1)}%`);
const tone = (c: number | null) => (c === null || c === 0 ? "" : c > 0 ? "text-green-700" : "text-red-700");
const signed = (c: number | null) => (c === null ? "-" : `${c > 0 ? "+" : ""}${formatCents(c)}`);

function useSort<K extends string>(initial: K, dir: Dir = "desc") {
  const [key, setKey] = useState<K>(initial);
  const [d, setD] = useState<Dir>(dir);
  const toggle = (k: K) => {
    if (k === key) setD(d === "desc" ? "asc" : "desc");
    else {
      setKey(k);
      setD("desc");
    }
  };
  return { key, dir: d, toggle };
}

function compare(a: unknown, b: unknown, dir: Dir): number {
  // blanks (no cost, no percentage) always sort last
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  const r = typeof a === "string" ? a.localeCompare(String(b)) : (a as number) - (b as number);
  return dir === "asc" ? r : -r;
}

function Th<K extends string>({ k, sort, children, right }: { k: K; sort: { key: K; dir: Dir; toggle: (k: K) => void }; children: React.ReactNode; right?: boolean }) {
  const on = sort.key === k;
  return (
    <th className={clsx("p-2", right && "text-right")}>
      <button type="button" onClick={() => sort.toggle(k)} className={clsx("inline-flex items-center gap-1 hover:text-zinc-900", on && "text-zinc-900")}>
        {children}
        <span className="w-3 text-[10px]">{on ? (sort.dir === "desc" ? "▼" : "▲") : ""}</span>
      </button>
    </th>
  );
}

export function GainsView({
  unrealized,
  unknownCost,
  noMarket,
  marketAsOf,
  realized,
}: {
  unrealized: UnrealizedRow[];
  unknownCost: number;
  noMarket: number;
  marketAsOf: string | null;
  realized: Realized[];
}) {
  const [tab, setTab] = useState<"stock" | "sold">("stock");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [only, setOnly] = useState<"" | "gain" | "loss">("");
  const [show, setShow] = useState("");
  const uSort = useSort<"totalGainCents" | "gainCents" | "gainPct" | "costCents" | "marketCents" | "qty" | "name">("totalGainCents");
  const rSort = useSort<"gainCents" | "gainPct" | "soldCents" | "costCents" | "soldOn" | "name">("gainCents");

  const match = (r: { name: string; setName: string; cardNumber: string; kind: string }) =>
    (!kind || r.kind === kind) && (!q.trim() || `${r.name} ${r.setName} ${r.cardNumber}`.toLowerCase().includes(q.trim().toLowerCase()));
  const sign = (g: number | null) => !only || (g !== null && (only === "gain" ? g > 0 : g < 0));

  const uRows = useMemo(
    () => unrealized.filter((r) => match(r) && sign(r.gainCents)).sort((a, b) => compare(a[uSort.key], b[uSort.key], uSort.dir)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unrealized, q, kind, only, uSort.key, uSort.dir],
  );
  const shows = useMemo(() => [...new Set(realized.map((r) => r.eventName))], [realized]);
  const rRows = useMemo(
    () =>
      realized
        .filter((r) => match(r) && sign(r.gainCents) && (!show || r.eventName === (show === "(no show)" ? "" : show)))
        .sort((a, b) => compare(a[rSort.key], b[rSort.key], rSort.dir)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [realized, q, kind, only, show, rSort.key, rSort.dir],
  );

  const uTot = uRows.reduce(
    (t, r) => ({ copies: t.copies + r.qty, cost: t.cost + r.totalCostCents, market: t.market + r.totalMarketCents, gain: t.gain + r.totalGainCents }),
    { copies: 0, cost: 0, market: 0, gain: 0 },
  );
  const rTot = rRows.reduce(
    (t, r) => ({
      cards: t.cards + 1,
      sold: t.sold + r.soldCents,
      cost: t.cost + (r.costCents ?? 0),
      gain: t.gain + (r.gainCents ?? 0),
      unknown: t.unknown + (r.costCents === null ? 1 : 0),
    }),
    { cards: 0, sold: 0, cost: 0, gain: 0, unknown: 0 },
  );

  const exportHref = tab === "stock" ? "/api/export/gains?view=unrealized" : "/api/export/gains?view=realized";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-zinc-300 bg-white p-0.5 text-sm">
          {(
            [
              ["stock", "In stock (unrealized)"],
              ["sold", "Sold (realized)"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={clsx("rounded px-3 py-1.5", tab === k ? "bg-zinc-900 text-white" : "text-zinc-700")}>
              {label}
            </button>
          ))}
        </div>
        <Input placeholder="Search name, set, number" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Raw, slabs, sealed</option>
          <option value="raw">Raw</option>
          <option value="slab">Slabs</option>
          <option value="sealed">Sealed</option>
        </Select>
        <Select value={only} onChange={(e) => setOnly(e.target.value as "" | "gain" | "loss")}>
          <option value="">Gains and losses</option>
          <option value="gain">Gains only</option>
          <option value="loss">Losses only</option>
        </Select>
        {tab === "sold" && shows.length > 0 && (
          <Select value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="">All shows</option>
            {shows.map((s) => (
              <option key={s || "(no show)"} value={s || "(no show)"}>
                {s || "(no show)"}
              </option>
            ))}
          </Select>
        )}
        <a href={exportHref} className="ml-auto rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-100">
          Export CSV
        </a>
      </div>

      {tab === "stock" ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Copies with a cost" value={uTot.copies} hint={unknownCost || noMarket ? `${unknownCost} without a cost, ${noMarket} without a market price, not counted` : undefined} />
            <Stat label="Cost" value={formatCents(uTot.cost)} />
            <Stat label="Market value" value={formatCents(uTot.market)} hint={marketAsOf ? `prices as of ${marketAsOf}` : undefined} />
            <Stat
              label="Unrealized gain"
              value={<span className={tone(uTot.gain)}>{signed(uTot.gain)}</span>}
              hint={uTot.cost > 0 ? pct(Math.round((uTot.gain * 10000) / uTot.cost) / 100) : undefined}
            />
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                <tr>
                  <Th k="name" sort={uSort}>
                    Card
                  </Th>
                  <Th k="qty" sort={uSort} right>
                    Qty
                  </Th>
                  <Th k="costCents" sort={uSort} right>
                    Cost each
                  </Th>
                  <Th k="marketCents" sort={uSort} right>
                    Market each
                  </Th>
                  <Th k="gainCents" sort={uSort} right>
                    Difference each
                  </Th>
                  <Th k="gainPct" sort={uSort} right>
                    %
                  </Th>
                  <Th k="totalGainCents" sort={uSort} right>
                    Total
                  </Th>
                </tr>
              </thead>
              <tbody>
                {uRows.map((r) => (
                  <tr key={`${r.productId}-${r.costCents}`} className="border-t border-zinc-100">
                    <td className="p-2">
                      <div className="font-medium">
                        {r.name} {r.badge && <Badge tone={r.kind === "slab" ? "blue" : "zinc"}>{r.badge}</Badge>}
                      </div>
                      <div className="text-xs text-zinc-500">{[r.setName, r.cardNumber && `#${r.cardNumber}`, r.variant].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="p-2 text-right tabular-nums">{r.qty}</td>
                    <td className="p-2 text-right tabular-nums">{money(r.costCents)}</td>
                    <td className="p-2 text-right tabular-nums">{money(r.marketCents)}</td>
                    <td className={clsx("p-2 text-right font-medium tabular-nums", tone(r.gainCents))}>{signed(r.gainCents)}</td>
                    <td className={clsx("p-2 text-right tabular-nums", tone(r.gainCents))}>{pct(r.gainPct)}</td>
                    <td className={clsx("p-2 text-right font-semibold tabular-nums", tone(r.totalGainCents))}>{signed(r.totalGainCents)}</td>
                  </tr>
                ))}
                {uRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-zinc-500">
                      {unrealized.length === 0 ? "No in-stock cards with both a cost and a market price yet." : "Nothing matches this filter."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Cards sold or traded" value={rTot.cards} hint={rTot.unknown ? `${rTot.unknown} without a cost` : undefined} />
            <Stat label="Brought in" value={formatCents(rTot.sold)} />
            <Stat label="Cost" value={formatCents(rTot.cost)} />
            <Stat label="Realized gain" value={<span className={tone(rTot.gain)}>{signed(rTot.gain)}</span>} hint={rTot.unknown ? "cards with no cost left out" : undefined} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                <tr>
                  <Th k="soldOn" sort={rSort}>
                    Date
                  </Th>
                  <Th k="name" sort={rSort}>
                    Card
                  </Th>
                  <Th k="soldCents" sort={rSort} right>
                    Sold for
                  </Th>
                  <Th k="costCents" sort={rSort} right>
                    Cost
                  </Th>
                  <Th k="gainCents" sort={rSort} right>
                    Difference
                  </Th>
                  <Th k="gainPct" sort={rSort} right>
                    %
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rRows.map((r) => (
                  <tr key={`${r.transactionId}-${r.code}`} className="border-t border-zinc-100">
                    <td className="p-2 whitespace-nowrap text-zinc-600">
                      {r.soldOn}
                      <div className="text-xs text-zinc-400">{r.eventName || "no show"}</div>
                    </td>
                    <td className="p-2">
                      <div className="font-medium">
                        {r.name} {r.badge && <Badge tone={r.kind === "slab" ? "blue" : "zinc"}>{r.badge}</Badge>} {r.how === "traded" && <Badge tone="amber">traded</Badge>}
                      </div>
                      <div className="text-xs text-zinc-500">
                        <span className="font-mono">{r.code}</span> {[r.setName, r.cardNumber && `#${r.cardNumber}`].filter(Boolean).join(" ")}
                      </div>
                    </td>
                    <td className="p-2 text-right tabular-nums">{money(r.soldCents)}</td>
                    <td className="p-2 text-right tabular-nums">{money(r.costCents)}</td>
                    <td className={clsx("p-2 text-right font-semibold tabular-nums", tone(r.gainCents))}>{signed(r.gainCents)}</td>
                    <td className={clsx("p-2 text-right tabular-nums", tone(r.gainCents))}>{pct(r.gainPct)}</td>
                  </tr>
                ))}
                {rRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-zinc-500">
                      {realized.length === 0 ? "Nothing sold yet." : "Nothing matches this filter."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
