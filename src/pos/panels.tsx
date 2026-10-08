"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { allocate } from "@/lib/allocate";
import type { DealOp } from "@/lib/ops";
import { getMeta, setMeta, type LocalDeal, type LocalSettings, type OutboxItem } from "./db";
import { CartEntry, CartList, useCart } from "./cart";
import { clampOfferPercent } from "@/lib/pricing";
import { IncomingForm, IncomingList, MoneyInput, PaymentBox, PercentPicker, expandIncoming, money, repriceIncoming, type IncomingItem } from "./parts";
import { lastDeals, recordDeal, recordVoid, retryErrors } from "./sync";
import { posDb } from "./db";
import { usePersistentState } from "./persist";
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

function baseDeal(ctx: Ctx, kind: DealOp["kind"]): DealOp {
  return {
    type: "deal",
    id: crypto.randomUUID(),
    kind,
    occurredAt: new Date().toISOString(),
    eventId: ctx.eventId,
    note: "",
    device: ctx.device,
    out: [],
    misc: [],
    in: [],
    payments: [],
  };
}

function ConfirmButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-lg bg-green-600 py-4 text-lg font-semibold text-white active:bg-green-700 disabled:bg-zinc-700"
    >
      {children}
    </button>
  );
}

const weightOf = (u: { priceCents: number | null; marketCents: number | null }) => u.priceCents ?? u.marketCents ?? 100;

/* ---------------------------------------------------------------- sell */

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-400">{children}</div>;
}

export function SellPanel({ ctx }: { ctx: Ctx }) {
  const cart = useCart("nk:cart:sell");
  const [misc, setMisc] = usePersistentState<{ key: string; description: string; amountCents: number }[]>("nk:cart:sell-misc", []);
  const [miscOpen, setMiscOpen] = useState(false);
  const [miscDesc, setMiscDesc] = useState("Bulk");
  const [miscAmount, setMiscAmount] = useState<number | null>(null);
  const [total, setTotal] = usePersistentState<number | null>("nk:cart:sell-total", null);
  const [pays, setPays] = useState<{ method: string; amountCents: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // a card opened from its sticker link (/u/CODE -> /pos?add=CODE)
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("add");
    if (code) {
      void cart.add(code);
      window.history.replaceState(null, "", "/pos");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const miscTotal = misc.reduce((n, m) => n + m.amountCents, 0);
  const subtotal = cart.stickerTotal + miscTotal;
  const agreed = total ?? subtotal;
  const count = cart.lines.length + misc.length;
  const unpriced = cart.lines.filter((l) => l.priceCents === null).length;

  function discount(pct: number) {
    setTotal(Math.round((subtotal * (100 - pct)) / 100));
  }
  function roundDown() {
    const step = agreed >= 2000 ? 500 : 100;
    setTotal(Math.floor(agreed / step) * step);
  }

  async function confirmSale() {
    if (!pays) return;
    setBusy(true);
    setError(null);
    try {
      const weights = [...cart.lines.map(weightOf), ...misc.map((m) => m.amountCents)];
      const parts = allocate(agreed, weights);
      const op = baseDeal(ctx, "sale");
      op.out = cart.lines.map((l, i) => ({ unitId: l.id, amountCents: parts[i]!, stickerCents: l.priceCents }));
      op.misc = misc.map((m, j) => ({ description: m.description, amountCents: parts[cart.lines.length + j]! }));
      op.payments = pays.map((p) => ({ ...p, direction: "in" as const }));
      const what = cart.lines.length === 1 && misc.length === 0 ? cart.lines[0]!.name : `${count} items`;
      const how = pays.map((p) => ctx.settings.paymentMethods.find((m) => m.id === p.method)?.label ?? p.method).join(" + ");
      await recordDeal(op, `Sold ${what}`);
      cart.clear();
      setMisc([]);
      setTotal(null);
      ctx.onRecorded(`Sold ${what} for ${money(agreed)} (${how})`, op.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <CartEntry cart={cart} scanning={ctx.scanning} setScanning={ctx.setScanning} />
      <CartList cart={cart} />
      {misc.length > 0 && (
        <ul className="rounded-lg border border-zinc-800 bg-zinc-900 px-3">
          {misc.map((m) => (
            <li key={m.key} className="flex items-center justify-between border-b border-zinc-800 py-2 text-sm last:border-0">
              <span>{m.description}</span>
              <span className="flex items-center tabular-nums">
                {money(m.amountCents)}
                <button type="button" className="px-2 text-xl leading-none text-zinc-500" onClick={() => setMisc(misc.filter((x) => x.key !== m.key))}>
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {miscOpen ? (
        <div className="flex items-center gap-2">
          <input className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2" value={miscDesc} onChange={(e) => setMiscDesc(e.target.value)} />
          <MoneyInput cents={miscAmount} onChange={setMiscAmount} className="w-28" autoFocus />
          <button
            type="button"
            disabled={!miscDesc.trim() || !miscAmount}
            className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-950 disabled:bg-zinc-700"
            onClick={() => {
              setMisc([...misc, { key: crypto.randomUUID(), description: miscDesc.trim(), amountCents: miscAmount! }]);
              setMiscAmount(null);
              setMiscOpen(false);
            }}
          >
            Add
          </button>
        </div>
      ) : (
        <button type="button" className="text-sm text-zinc-400 underline" onClick={() => setMiscOpen(true)}>
          + Item without a sticker (bulk, bins)
        </button>
      )}

      {count > 0 && (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">
              {count} item{count === 1 ? "" : "s"} at sticker
            </span>
            <span className="tabular-nums">{money(subtotal)}</span>
          </div>
          {unpriced > 0 && <p className="text-xs text-amber-300">{unpriced} card(s) have no price; they count at market. Type the agreed total.</p>}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Total</span>
            <MoneyInput cents={agreed} onChange={(c) => setTotal(c ?? 0)} className="flex-1" />
          </div>
          <div className="grid grid-cols-4 gap-1.5 text-sm">
            {[5, 10, 15].map((p) => (
              <button key={p} type="button" onClick={() => discount(p)} className="rounded border border-zinc-700 py-1.5">
                -{p}%
              </button>
            ))}
            <button type="button" onClick={roundDown} className="rounded border border-zinc-700 py-1.5">
              Round down
            </button>
          </div>
          {total !== null && total !== subtotal && (
            <button type="button" className="text-xs text-zinc-400 underline" onClick={() => setTotal(null)}>
              Back to sticker total
            </button>
          )}
          <PaymentBox methods={ctx.settings.paymentMethods} totalCents={agreed} onChange={setPays} label="Paid with" rememberKey="nk:pay:sell" />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="button"
            className="w-full py-1 text-sm text-zinc-400"
            onClick={() => {
              if (!confirm("Empty the cart?")) return;
              cart.clear();
              setMisc([]);
              setTotal(null);
            }}
          >
            Clear cart
          </button>
        </div>
      )}

      {count === 0 && (
        <Hint>
          <p className="font-medium text-zinc-200">Scan a sticker to start a sale</p>
          <p className="mt-1">
            Hold the QR code on the toploader in the frame: it beeps and the card drops into the cart. Keep scanning to bundle
            cards. Then check the total and tap <b>Confirm</b> at the bottom. No QR? Type the 6-letter code or search the name.
          </p>
        </Hint>
      )}

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-800 bg-zinc-900/95 px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+10px)] backdrop-blur">
          <div className="mx-auto flex max-w-md items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold tabular-nums">{money(agreed)}</div>
              <div className="truncate text-xs text-zinc-400">
                {count} item{count === 1 ? "" : "s"} ·{" "}
                {pays && pays.length ? pays.map((p) => ctx.settings.paymentMethods.find((m) => m.id === p.method)?.label ?? p.method).join(" + ") : "pick how they paid"}
              </div>
            </div>
            <button
              type="button"
              disabled={busy || !pays || agreed <= 0}
              onClick={() => void confirmSale()}
              className="rounded-lg bg-green-600 px-5 py-3 text-base font-semibold text-white active:bg-green-700 disabled:bg-zinc-700"
            >
              Confirm sale {money(agreed)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- buy */

/** The offer for cards coming in (60-100% of market), remembered on this phone per tab. */
function useOfferPercent(metaKey: string, initial: number) {
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

export function BuyPanel({ ctx }: { ctx: Ctx }) {
  const [items, setItems] = usePersistentState<IncomingItem[]>("nk:cart:buy", []);
  const [offer, setOfferState] = useOfferPercent("offerPercent", 70);
  const [pays, setPays] = useState<{ method: string; amountCents: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = items.reduce((n, i) => n + i.eachCents * i.qty, 0);
  const cards = items.reduce((n, i) => n + i.qty, 0);

  function setOffer(pct: number) {
    setOfferState(pct);
    // cards already in the cart follow the new percent, except amounts typed by hand
    setItems((xs) => repriceIncoming(xs, clampOfferPercent(pct), ctx.settings.pricing));
  }

  async function confirm() {
    if (!pays) return;
    setBusy(true);
    setError(null);
    try {
      const op = baseDeal(ctx, "buy");
      op.in = await expandIncoming(items);
      op.payments = pays.map((p) => ({ ...p, direction: "out" as const }));
      await recordDeal(op, `Bought ${cards === 1 ? items[0]!.product.name : `${cards} cards`}`);
      setItems([]);
      ctx.onRecorded(`Bought ${cards} for ${money(total)}. Stickers queue on the laptop.`, op.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <PercentPicker label="Cash offer" value={offer} onChange={setOffer} />
      {items.length === 0 && (
        <Hint>
          <p className="font-medium text-zinc-200">Buying cards from a customer</p>
          <p className="mt-1">
            Take a photo or search a card, check it&apos;s the right one, then <b>Add to cart</b>. Repeat for the whole stack: each
            card is its own line in one cart. <b>Pay each</b> is your cash offer % of market (move the slider and the cart
            follows); <b>Sticker each</b> is your pricing rule. Then pay and confirm once. Cards go into stock with what you paid as
            their cost, and their stickers wait on the laptop&apos;s Stickers page.
          </p>
        </Hint>
      )}
      <IncomingForm offerPercent={offer} rule={ctx.settings.pricing} onAdd={(it) => setItems((xs) => [...xs, it])} verb="Pay" />
      <IncomingList items={items} onRemove={(k) => setItems((xs) => xs.filter((i) => i.key !== k))} verb="paid" />
      {items.length > 0 && (
        <div id="buy-checkout" className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <div className="flex justify-between text-sm">
            <span>
              {cards} card{cards === 1 ? "" : "s"}
            </span>
            <span className="font-semibold tabular-nums">{money(total)}</span>
          </div>
          <PaymentBox methods={ctx.settings.paymentMethods} totalCents={total} onChange={setPays} label="I paid with" rememberKey="nk:pay:buy" />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <ConfirmButton disabled={busy || !pays} onClick={() => void confirm()}>
            Confirm buy {money(total)}
          </ConfirmButton>
          <button
            type="button"
            className="w-full py-1 text-sm text-zinc-400"
            onClick={() => {
              if (window.confirm("Empty the cart?")) setItems([]);
            }}
          >
            Clear cart
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-800 bg-zinc-900/95 px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+10px)] backdrop-blur">
          <div className="mx-auto flex max-w-md items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold tabular-nums">{money(total)}</div>
              <div className="truncate text-xs text-zinc-400">
                {cards} card{cards === 1 ? "" : "s"} in the cart · {offer}% offer
              </div>
            </div>
            <button
              type="button"
              onClick={() => document.getElementById("buy-checkout")?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className="rounded-lg bg-green-600 px-5 py-3 text-base font-semibold text-white active:bg-green-700"
            >
              Pay {money(total)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- trade */

export function TradePanel({ ctx }: { ctx: Ctx }) {
  const cart = useCart("nk:cart:trade");
  const [outTotal, setOutTotal] = usePersistentState<number | null>("nk:cart:trade-total", null);
  const [items, setItems] = usePersistentState<IncomingItem[]>("nk:cart:trade-in", []);
  const [credit, setCreditState] = useOfferPercent("tradePercent", ctx.settings.tradeInPercent);
  const [pays, setPays] = useState<{ method: string; amountCents: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const outValue = outTotal ?? cart.stickerTotal;
  const inValue = items.reduce((n, i) => n + i.eachCents * i.qty, 0);
  const diff = outValue - inValue;

  function setCredit(pct: number) {
    setCreditState(pct);
    setItems((xs) => repriceIncoming(xs, clampOfferPercent(pct), ctx.settings.pricing));
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const op = baseDeal(ctx, "trade");
      const parts = allocate(outValue, cart.lines.map(weightOf));
      op.out = cart.lines.map((l, i) => ({ unitId: l.id, amountCents: parts[i]!, stickerCents: l.priceCents }));
      op.in = await expandIncoming(items);
      op.payments = diff === 0 ? [] : (pays ?? []).map((p) => ({ ...p, direction: diff > 0 ? ("in" as const) : ("out" as const) }));
      await recordDeal(op, `Traded ${cart.lines.length} for ${items.reduce((n, i) => n + i.qty, 0)}`);
      cart.clear();
      setItems([]);
      setOutTotal(null);
      ctx.onRecorded(`Trade recorded${diff !== 0 ? `, ${diff > 0 ? "they paid" : "you paid"} ${money(Math.abs(diff))}` : ""}`, op.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {cart.lines.length === 0 && items.length === 0 && (
        <Hint>
          <p className="font-medium text-zinc-200">Trading with a customer</p>
          <p className="mt-1">
            Scan your cards going out (their value starts at the sticker prices; change it if you agree on another), then add
            their cards coming in (photo or search, check, Add to cart) at your trade credit % of market. The difference shows who pays whom and how much.
          </p>
        </Hint>
      )}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">My cards going out</h3>
        <CartEntry cart={cart} scanning={ctx.scanning} setScanning={ctx.setScanning} />
        <CartList cart={cart} />
        {cart.lines.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span>Value</span>
            <MoneyInput cents={outValue} onChange={(c) => setOutTotal(c ?? 0)} className="flex-1" />
          </div>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Their cards coming in</h3>
        <PercentPicker label="Trade credit" value={credit} onChange={setCredit} />
        <IncomingForm offerPercent={credit} rule={ctx.settings.pricing} onAdd={(it) => setItems((xs) => [...xs, it])} verb="Credit" />
        <IncomingList items={items} onRemove={(k) => setItems((xs) => xs.filter((i) => i.key !== k))} verb="credit" />
      </section>
      {cart.lines.length > 0 && items.length > 0 && (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <div className="grid grid-cols-3 text-center text-sm">
            <div>
              <div className="text-xs text-zinc-400">Out</div>
              <div className="tabular-nums">{money(outValue)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-400">In</div>
              <div className="tabular-nums">{money(inValue)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-400">{diff > 0 ? "They pay" : diff < 0 ? "You pay" : "Even"}</div>
              <div className={clsx("font-semibold tabular-nums", diff > 0 ? "text-green-300" : diff < 0 ? "text-red-300" : "")}>{money(Math.abs(diff))}</div>
            </div>
          </div>
          {diff !== 0 && (
            <PaymentBox methods={ctx.settings.paymentMethods} totalCents={Math.abs(diff)} onChange={setPays} label={diff > 0 ? "They paid with" : "I paid with"} rememberKey="nk:pay:trade" />
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
          <ConfirmButton disabled={busy || (diff !== 0 && !pays)} onClick={() => void confirm()}>
            Confirm trade
          </ConfirmButton>
        </div>
      )}
    </div>
  );
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
          <li><b>Sell</b>: scan stickers into the cart, adjust the total if you make a deal, pick how they paid, Confirm. A bundle&apos;s price is split across the cards by sticker price.</li>
          <li><b>Buy</b> and <b>Trade</b>: set your % of market with the slider, then photo or search each card, check it, and Add to cart. One cart per deal until you confirm. Cards coming in become stock with their cost; their stickers print later on the laptop.</li>
          <li><b>No signal is fine.</b> Everything is saved on this phone first and sent when there is signal: the pill at the top shows how many deals are waiting. Keep the app open from the home-screen icon.</li>
          <li><b>Mistakes</b>: tap Undo on the message after a deal, or Void it below. Its cards go back into stock.</li>
          <li><b>Carts are saved</b>: closing the app, reloading, or scanning a sticker with the camera app keeps the same cart.</li>
          <li>Pick the <b>show</b> below so the sales land in the right place.</li>
        </ul>
      </Explainer>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm">
        <label className="flex items-center gap-2">
          Show
          <select className="min-w-0 flex-1 rounded border border-zinc-700 px-2 py-1.5" value={ctx.eventId ?? ""} onChange={(e) => onEvent(e.target.value || null)}>
            <option value="">(no show)</option>
            {ctx.settings.events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.startsOn})
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs text-zinc-400">{units} cards in stock on this phone · device {ctx.device}</p>
        <div className="mt-2 flex gap-2">
          <button type="button" className="rounded-md border border-zinc-700 px-3 py-1.5" onClick={onSync}>
            Sync now
          </button>
          <button type="button" className="rounded-md border border-zinc-700 px-3 py-1.5" onClick={onFullSync}>
            Re-download inventory
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="space-y-2 rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm">
          <p className="font-medium text-red-200">{errors.length} deal(s) the server refused. They are kept on this phone.</p>
          <ul className="list-disc pl-5 text-red-300">
            {errors.map((e) => (
              <li key={e.id}>{e.error}</li>
            ))}
          </ul>
          <button type="button" className="rounded-md bg-red-600 px-3 py-1.5 text-white" onClick={() => void retryErrors().then(onSync)}>
            Retry
          </button>
        </div>
      )}

      <ul className="rounded-lg border border-zinc-800 bg-zinc-900 px-3">
        {deals.length === 0 && <li className="py-6 text-center text-sm text-zinc-400">No deals on this phone yet.</li>}
        {deals.map((d) => (
          <li key={d.id} className={clsx("flex items-center gap-2 border-b border-zinc-800 py-2 text-sm last:border-0", d.voidedBy && "opacity-50")}>
            <div className="min-w-0 flex-1">
              <div className={clsx("truncate", d.voidedBy && "line-through")}>
                <span className="mr-1 rounded bg-zinc-900 px-1 text-xs">{label(d.kind)}</span>
                {d.summary}
              </div>
              <div className="text-xs text-zinc-400">
                {new Date(d.occurredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ·{" "}
                {d.synced ? "synced" : <span className="text-amber-300">waiting to sync</span>}
                {d.conflicts?.length ? <span className="text-red-300"> · {d.conflicts.join("; ")}</span> : null}
              </div>
            </div>
            <span className={clsx("tabular-nums", d.netCents >= 0 ? "text-green-300" : "text-red-300")}>
              {d.netCents >= 0 ? "+" : "-"}
              {money(Math.abs(d.netCents))}
            </span>
            {!d.voidedBy && (
              <button
                type="button"
                className="rounded border border-zinc-700 px-2 py-1 text-xs"
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
