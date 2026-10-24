"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { buildDeal, outSticker, settle, type MiscItem, type OutItem } from "@/lib/deal";
import { clampOfferPercent } from "@/lib/pricing";
import { CartEntry, CartList, useCart } from "./cart";
import { IncomingForm, IncomingList, MoneyInput, PaymentBox, PercentPicker, expandIncoming, money, repriceIncoming, type IncomingItem } from "./parts";
import { Hint, useOfferPercent, type Ctx } from "./panels";
import { usePersistentState } from "./persist";
import { recordDeal } from "./sync";

type Misc = MiscItem & { key: string };

/**
 * One cart for the whole deal: scan what goes out, add what comes in, settle the difference
 * either way. Whether it is a sale, a buy or a trade follows from the cart.
 */
export function DealPanel({ ctx }: { ctx: Ctx }) {
  const cart = useCart("nk:cart:deal");
  const [misc, setMisc] = usePersistentState<Misc[]>("nk:cart:deal-misc", []);
  const [items, setItems] = usePersistentState<IncomingItem[]>("nk:cart:deal-in", []);
  // the agreed money, signed: positive they pay me, negative I pay them; null = as priced
  const [agreed, setAgreed] = usePersistentState<number | null>("nk:cart:deal-agreed", null);
  const [inOpen, setInOpen] = useState(false);
  const [miscOpen, setMiscOpen] = useState(false);
  const [miscDesc, setMiscDesc] = useState("Bulk");
  const [miscAmount, setMiscAmount] = useState<number | null>(null);
  const [offer, setOfferState] = useOfferPercent("offerPercent", ctx.settings.tradeInPercent);
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

  const out: OutItem[] = cart.lines.map((l) => ({ unitId: l.id, stickerCents: l.priceCents, marketCents: l.marketCents }));
  const inCents = items.reduce((n, i) => n + i.eachCents * i.qty, 0);
  const sticker = outSticker(out, misc);
  const asPriced = sticker - inCents;
  const money$ = settle({ out, misc, inCents, agreedCents: agreed });
  const hasOut = out.length + misc.length > 0;
  const outCount = out.length + misc.length;
  const inCount = items.reduce((n, i) => n + i.qty, 0);
  const empty = outCount + inCount === 0;
  const unpriced = cart.lines.filter((l) => l.priceCents === null).length;
  const showIn = inOpen || items.length > 0;
  const s = money$?.settleCents ?? asPriced;
  // who pays: follows the amount; at zero, the last side picked (else they pay when something goes out)
  const [dirPick, setDirPick] = useState<1 | -1 | null>(null);
  const dir = s !== 0 ? (Math.sign(s) as 1 | -1) : (dirPick ?? (hasOut ? 1 : -1));
  const theyPay = dir === 1;

  function setOffer(pct: number) {
    setOfferState(pct);
    // cards already in the cart follow the new percent, except amounts typed by hand
    setItems((xs) => repriceIncoming(xs, clampOfferPercent(pct), ctx.settings.pricing));
  }

  function discount(pct: number) {
    setAgreed(Math.round((sticker * (100 - pct)) / 100) - inCents);
  }
  /** rounds the money that changes hands down, in the customer's favour when they pay and mine when I pay */
  function roundDown() {
    const abs = Math.abs(s);
    const step = abs >= 2000 ? 500 : 100;
    setAgreed(Math.sign(s) * Math.floor(abs / step) * step);
  }

  function clear() {
    cart.clear();
    setMisc([]);
    setItems([]);
    setAgreed(null);
    setDirPick(null);
    setInOpen(false);
  }

  function summary(kind: string): string {
    const first = cart.lines[0]?.name ?? misc[0]?.description ?? "";
    const outText = outCount === 1 ? first : `${outCount} items`;
    const inText = inCount === 1 ? items[0]!.product.name : `${inCount} cards`;
    if (kind === "sale") return `Sold ${outText}`;
    if (kind === "buy") return `Bought ${inText}`;
    return `Traded ${outText} for ${inText}`;
  }

  async function confirmDeal() {
    if (!money$) return;
    setBusy(true);
    setError(null);
    try {
      const op = buildDeal({
        id: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        eventId: ctx.eventId,
        device: ctx.device,
        out,
        misc: misc.map((m) => ({ description: m.description, amountCents: m.amountCents })),
        in: await expandIncoming(items),
        money: money$,
        payments: money$.settleCents === 0 ? [] : (pays ?? []),
      });
      const text = summary(op.kind);
      const how = op.payments.map((p) => ctx.settings.paymentMethods.find((m) => m.id === p.method)?.label ?? p.method).join(" + ");
      await recordDeal(op, text);
      clear();
      const cash = money$.settleCents === 0 ? "even" : `${money$.settleCents > 0 ? "they paid" : "you paid"} ${money(Math.abs(money$.settleCents))}${how ? ` (${how})` : ""}`;
      ctx.onRecorded(`${text}: ${cash}${op.in.length ? ". Stickers for cards in queue on the laptop." : ""}`, op.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const needsPay = money$ !== null && money$.settleCents !== 0;
  const canConfirm = !busy && !empty && money$ !== null && (!needsPay || pays !== null);

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Going out</h3>
        <CartEntry cart={cart} scanning={ctx.scanning} setScanning={ctx.setScanning} />
        <CartList cart={cart} />
        {misc.length > 0 && (
          <ul className="rounded-lg border border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-900">
            {misc.map((m) => (
              <li key={m.key} className="flex items-center justify-between border-b border-zinc-200 py-2 text-sm last:border-0 dark:border-zinc-800">
                <span>{m.description}</span>
                <span className="flex items-center tabular-nums">
                  {money(m.amountCents)}
                  <button type="button" className="px-2 text-xl leading-none text-zinc-400 dark:text-zinc-500" onClick={() => setMisc(misc.filter((x) => x.key !== m.key))}>
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {miscOpen ? (
          <div className="flex items-center gap-2">
            <input className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900" value={miscDesc} onChange={(e) => setMiscDesc(e.target.value)} />
            <MoneyInput cents={miscAmount} onChange={setMiscAmount} className="w-28" autoFocus />
            <button
              type="button"
              disabled={!miscDesc.trim() || !miscAmount}
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-950 dark:disabled:bg-zinc-700"
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
          <button type="button" className="text-sm text-zinc-500 underline dark:text-zinc-400" onClick={() => setMiscOpen(true)}>
            + Item without a sticker (bulk, bins)
          </button>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Coming in</h3>
          {!showIn && (
            <button type="button" onClick={() => setInOpen(true)} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              + Their cards
            </button>
          )}
        </div>
        {showIn && (
          <>
            <PercentPicker label="Offer" value={offer} onChange={setOffer} />
            <IncomingForm offerPercent={offer} rule={ctx.settings.pricing} onAdd={(it) => setItems((xs) => [...xs, it])} verb="Offer" />
            <IncomingList items={items} onRemove={(k) => setItems((xs) => xs.filter((i) => i.key !== k))} verb="offer" />
          </>
        )}
      </section>

      {empty && (
        <Hint>
          <p className="font-medium text-zinc-800 dark:text-zinc-200">Scan a sticker, or add their cards</p>
          <p className="mt-1">
            One cart for every deal. Scan your cards going out; tap <b>+ Their cards</b> for anything coming in. The bottom shows
            who pays whom; change the amount if you agree on another, pick how it was paid, and confirm once.
          </p>
        </Hint>
      )}

      {!empty && (
        <div id="deal-checkout" className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid grid-cols-2 text-sm">
            <div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">Out · {outCount} at sticker</div>
              <div className="tabular-nums">{money(sticker)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">In · {inCount} at {offer}%</div>
              <div className="tabular-nums">{money(inCents)}</div>
            </div>
          </div>
          {unpriced > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">{unpriced} card(s) have no price; they count at market.</p>}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1 rounded-md bg-zinc-100 p-1 text-sm dark:bg-zinc-800">
              {[
                [true, "They pay"],
                [false, "I pay"],
              ].map(([k, label]) => (
                <button
                  key={String(label)}
                  type="button"
                  onClick={() => {
                    if (k === theyPay) return;
                    setDirPick(dir === 1 ? -1 : 1);
                    if (s !== 0) setAgreed(-s);
                  }}
                  className={clsx("rounded py-1.5", theyPay === k && "bg-white font-medium shadow-sm dark:bg-zinc-900")}
                >
                  {label as string}
                </button>
              ))}
            </div>
            <MoneyInput cents={Math.abs(s)} onChange={(c) => setAgreed(dir * (c ?? 0))} />
            <div className="grid grid-cols-3 gap-1.5 text-sm">
              {hasOut &&
                [5, 10].map((p) => (
                  <button key={p} type="button" onClick={() => discount(p)} className="rounded border border-zinc-300 py-1.5 dark:border-zinc-700">
                    -{p}% out
                  </button>
                ))}
              <button type="button" onClick={roundDown} className={clsx("rounded border border-zinc-300 py-1.5 dark:border-zinc-700", !hasOut && "col-span-3")}>
                Round down
              </button>
            </div>
            {agreed !== null && (
              <button type="button" className="text-xs text-zinc-500 underline dark:text-zinc-400" onClick={() => setAgreed(null)}>
                Back to {asPriced === 0 ? "even" : `${asPriced > 0 ? "they pay" : "I pay"} ${money(Math.abs(asPriced))}`} (as priced)
              </button>
            )}
            {money$ === null && <p className="text-sm text-red-600 dark:text-red-400">That amount would price one side below zero.</p>}
          </div>
          {needsPay && (
            <PaymentBox
              key={theyPay ? "in" : "out"}
              methods={ctx.settings.paymentMethods}
              totalCents={Math.abs(money$!.settleCents)}
              onChange={setPays}
              label={theyPay ? "They paid with" : "I paid with"}
              rememberKey={theyPay ? "nk:pay:in" : "nk:pay:out"}
            />
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="button"
            className="w-full py-1 text-sm text-zinc-500 dark:text-zinc-400"
            onClick={() => {
              if (window.confirm("Empty the cart?")) clear();
            }}
          >
            Clear cart
          </button>
        </div>
      )}

      {!empty && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+10px)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
          <div className="mx-auto flex max-w-md items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className={clsx("text-lg font-semibold tabular-nums", s > 0 ? "text-green-700 dark:text-green-300" : s < 0 ? "text-red-700 dark:text-red-300" : "")}>
                {s === 0 ? "Even" : `${theyPay ? "They pay" : "I pay"} ${money(Math.abs(s))}`}
              </div>
              <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {outCount} out · {inCount} in
                {needsPay && ` · ${pays && pays.length ? pays.map((p) => ctx.settings.paymentMethods.find((m) => m.id === p.method)?.label ?? p.method).join(" + ") : "pick how"}`}
              </div>
            </div>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => void confirmDeal()}
              className="rounded-lg bg-green-600 px-5 py-3 text-base font-semibold text-white active:bg-green-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
