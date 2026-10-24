"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { getMeta, setMeta, type LocalDeal, type LocalSettings, type OutboxItem } from "./db";
import { clampOfferPercent } from "@/lib/pricing";
import { money } from "./parts";
import { lastDeals, recordVoid, retryErrors } from "./sync";
import { posDb } from "./db";
import { Explainer } from "@/components/explainer";

export type Ctx = {
  settings: LocalSettings;
  eventId: string | null;
  device: string;
  /** after a deal is recorded: show a toast and kick a sync */
  onRecorded: (text: string, dealId: string) => void;
  scanning: boolean;
  setScanning: (s: boolean) => void;
};

export function Hint({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 text-sm text-zinc-500 dark:text-zinc-400">{children}</div>;
}

/** The offer for cards coming in (60-100% of market), remembered on this phone. */
export function useOfferPercent(metaKey: string, initial: number) {
  const [pct, setPct] = useState(clampOfferPercent(initial));
  useEffect(() => {
    void getMeta<number>(metaKey).then((v) => v && setPct(clampOfferPercent(v)));
  }, [metaKey]);
  return [
    pct,
    (v: number) => {
      const next = clampOfferPercent(v);
      setPct(next);
      void setMeta(metaKey, next);
    },
  ] as const;
}

/* ---------------------------------------------------------------- history */

export function HistoryPanel({
  ctx,
  onSync,
  onFullSync,
  onEvent,
}: {
  ctx: Ctx;
  onSync: () => void;
  onFullSync: () => void;
  onEvent: (id: string | null) => void;
}) {
  const [deals, setDeals] = useState<LocalDeal[]>([]);
  const [errors, setErrors] = useState<OutboxItem[]>([]);
  const [units, setUnits] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void lastDeals(100).then(setDeals);
    void posDb().outbox.where("state").equals("error").toArray().then(setErrors);
    void posDb().units.where("status").equals("in_stock").count().then(setUnits);
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, [tick]);

  const label = (k: string) => ({ sale: "Sale", buy: "Buy", trade: "Trade" })[k] ?? k;

  return (
    <div className="space-y-4">
      <Explainer id="pos" title="How the POS works">
        <ul>
          <li><b>One cart per deal</b>: scan your cards going out, tap <b>+ Their cards</b> for anything coming in (photo or search, check, Add). It is a sale, a buy or a trade depending on what is in the cart.</li>
          <li>The bottom says <b>who pays whom</b>. Type another amount if you agree on one (out goes down like a discount, split over the cards), round it down, pick how it was paid, and Confirm. Cards coming in become stock with their cost; their stickers print later on the laptop.</li>
          <li><b>No signal is fine.</b> Everything is saved on this phone first and sent when there is signal: the pill at the top shows how many deals are waiting. Keep the app open from the home-screen icon.</li>
          <li><b>Mistakes</b>: tap Undo on the message after a deal, or Void it below. Its cards go back into stock.</li>
          <li><b>Carts are saved</b>: closing the app, reloading, or scanning a sticker with the camera app keeps the same cart.</li>
          <li>Pick the <b>show</b> below so the sales land in the right place.</li>
        </ul>
      </Explainer>
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 text-sm">
        <label className="flex items-center gap-2">
          Show
          <select className="min-w-0 flex-1 rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1.5" value={ctx.eventId ?? ""} onChange={(e) => onEvent(e.target.value || null)}>
            <option value="">(no show)</option>
            {ctx.settings.events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.startsOn})
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{units} cards in stock on this phone · device {ctx.device}</p>
        <div className="mt-2 flex gap-2">
          <button type="button" className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5" onClick={onSync}>
            Sync now
          </button>
          <button type="button" className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5" onClick={onFullSync}>
            Re-download inventory
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="space-y-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm">
          <p className="font-medium text-red-800 dark:text-red-200">{errors.length} deal(s) the server refused. They are kept on this phone.</p>
          <ul className="list-disc pl-5 text-red-700 dark:text-red-300">
            {errors.map((e) => (
              <li key={e.id}>{e.error}</li>
            ))}
          </ul>
          <button type="button" className="rounded-md bg-red-600 px-3 py-1.5 text-white" onClick={() => void retryErrors().then(onSync)}>
            Retry
          </button>
        </div>
      )}

      <ul className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3">
        {deals.length === 0 && <li className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">No deals on this phone yet.</li>}
        {deals.map((d) => (
          <li key={d.id} className={clsx("flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 py-2 text-sm last:border-0", d.voidedBy && "opacity-50")}>
            <div className="min-w-0 flex-1">
              <div className={clsx("truncate", d.voidedBy && "line-through")}>
                <span className="mr-1 rounded bg-zinc-100 dark:bg-zinc-800 px-1 text-xs">{label(d.kind)}</span>
                {d.summary}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {new Date(d.occurredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ·{" "}
                {d.synced ? "synced" : <span className="text-amber-700 dark:text-amber-300">waiting to sync</span>}
                {d.conflicts?.length ? <span className="text-red-700 dark:text-red-300"> · {d.conflicts.join("; ")}</span> : null}
              </div>
            </div>
            <span className={clsx("tabular-nums", d.netCents >= 0 ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300")}>
              {d.netCents >= 0 ? "+" : "-"}
              {money(Math.abs(d.netCents))}
            </span>
            {!d.voidedBy && (
              <button
                type="button"
                className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs"
                onClick={() => {
                  if (confirm(`Void "${d.summary}"? Cards go back in stock.`)) void recordVoid(d.id, ctx.device).then(() => { setTick((x) => x + 1); onSync(); });
                }}
              >
                Void
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
