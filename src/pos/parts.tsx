"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { newUnitCode } from "@/lib/codes";
import { formatCents, parseDollars } from "@/lib/money";
import type { ProductInput } from "@/lib/ops";
import { OFFER_MAX_PERCENT, OFFER_MIN_PERCENT, offerPrice, suggestPrice, type PricingRule } from "@/lib/pricing";
import type { PaymentMethod } from "@/lib/settings";
import { posDb } from "./db";
import { remember, remembered } from "./persist";
import { CardLookup, type LookupFill } from "./card-lookup";
import type { PosProduct, PosUnit } from "./types";

export const money = formatCents;

/** A text box for dollars that reports cents (null while empty or invalid). */
export function MoneyInput({
  cents,
  onChange,
  placeholder,
  className,
  autoFocus,
}: {
  cents: number | null;
  onChange: (c: number | null) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(cents === null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, ""));
  useEffect(() => {
    // follow outside changes (quick-discount buttons) unless the box already says the same amount
    if (parseDollars(text) !== cents) setText(cents === null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents]);
  return (
    <div className={clsx("flex items-center rounded-md border border-zinc-700 bg-zinc-900 px-2 focus-within:border-zinc-100", className)}>
      <span className="text-zinc-500">$</span>
      <input
        inputMode="decimal"
        autoFocus={autoFocus}
        className="w-full min-w-0 bg-transparent px-1 py-2 text-right text-lg tabular-nums outline-none"
        value={text}
        placeholder={placeholder}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseDollars(e.target.value));
        }}
      />
    </div>
  );
}

export function MethodPicker({
  methods,
  value,
  onChange,
}: {
  methods: PaymentMethod[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {methods.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onChange(m.id)}
          className={clsx(
            "rounded-md border py-2.5 text-sm font-medium",
            value === m.id ? "border-zinc-100 bg-zinc-100 text-zinc-950" : "border-zinc-700 bg-zinc-900 text-zinc-200",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** One method, or a split across two: returns payment amounts that always add up to the total. */
export function PaymentBox({
  methods,
  totalCents,
  onChange,
  label,
  rememberKey,
}: {
  methods: PaymentMethod[];
  totalCents: number;
  onChange: (p: { method: string; amountCents: number }[] | null) => void;
  label: string;
  /** remembers the last method picked here, so the usual one is preselected next time */
  rememberKey?: string;
}) {
  const [first, setFirstState] = useState<string | null>(() => {
    const last = rememberKey ? remembered<string | null>(rememberKey, null) : null;
    return last && methods.some((m) => m.id === last) ? last : (methods[0]?.id ?? null);
  });
  const setFirst = (id: string) => {
    setFirstState(id);
    if (rememberKey) remember(rememberKey, id);
  };
  const [split, setSplit] = useState(false);
  const [second, setSecond] = useState<string | null>(methods[1]?.id ?? null);
  const [firstAmount, setFirstAmount] = useState<number | null>(null);

  useEffect(() => {
    if (!first) return onChange(null);
    if (!split) return onChange(totalCents > 0 ? [{ method: first, amountCents: totalCents }] : []);
    const a = Math.min(firstAmount ?? 0, totalCents);
    if (!second || second === first) return onChange(null);
    onChange([
      { method: first, amountCents: a },
      { method: second, amountCents: totalCents - a },
    ].filter((p) => p.amountCents > 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, second, split, firstAmount, totalCents]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <label className="flex items-center gap-1.5 text-zinc-400">
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Split
        </label>
      </div>
      <MethodPicker methods={methods} value={first} onChange={setFirst} />
      {split && (
        <div className="space-y-2 rounded-md bg-zinc-900 p-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-24">{methods.find((m) => m.id === first)?.label}</span>
            <MoneyInput cents={firstAmount} onChange={setFirstAmount} className="flex-1" />
          </div>
          <div className="text-xs text-zinc-400">Rest ({money(Math.max(0, totalCents - (firstAmount ?? 0)))}) by:</div>
          <MethodPicker methods={methods.filter((m) => m.id !== first)} value={second} onChange={setSecond} />
        </div>
      )}
    </div>
  );
}

export function UnitRow({ u, right, onRemove }: { u: Pick<PosUnit, "name" | "setName" | "cardNumber" | "badge" | "code">; right?: React.ReactNode; onRemove?: () => void }) {
  return (
    <li className="flex items-center gap-2 border-b border-zinc-800 py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {u.name} {u.badge && <span className="rounded bg-zinc-900 px-1 text-xs text-zinc-400">{u.badge}</span>}
        </div>
        <div className="truncate text-xs text-zinc-400">
          <span className="font-mono">{u.code}</span> {[u.setName, u.cardNumber && `#${u.cardNumber}`].filter(Boolean).join(" ")}
        </div>
      </div>
      {right}
      {onRemove && (
        <button type="button" onClick={onRemove} className="px-2 text-xl leading-none text-zinc-500" aria-label="Remove">
          ×
        </button>
      )}
    </li>
  );
}

/** A card coming in (bought or traded in), before it has a code. */
export type IncomingItem = {
  key: string;
  product: ProductInput;
  qty: number;
  /** what I pay (or credit) for each copy */
  eachCents: number;
  /** sticker price for each copy, null to price later on the laptop */
  priceCents: number | null;
  /** eachCents follows the offer percent: moving the slider re-prices it (false once typed by hand) */
  offerAuto?: boolean;
};

/** Re-prices the cards that follow the offer percent; amounts typed by hand stay. */
export function repriceIncoming(items: IncomingItem[], percent: number, rule: PricingRule): IncomingItem[] {
  return items.map((it) =>
    it.offerAuto && it.product.marketCents !== null ? { ...it, eachCents: offerPrice(it.product.marketCents, percent, rule) } : it,
  );
}

const PERCENT_CHIPS = [60, 65, 70, 75, 80, 85, 90, 95, 100];

/** The offer for cards coming in, 60-100% of market: a slider plus one-tap steps. */
export function PercentPicker({ value, onChange, label }: { value: number; onChange: (pct: number) => void; label: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span>
          <span className="text-2xl font-semibold tabular-nums">{value}%</span> <span className="text-sm text-zinc-400">of market</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Lower" className="h-9 w-9 shrink-0 rounded border border-zinc-700 text-lg" onClick={() => onChange(Math.max(OFFER_MIN_PERCENT, value - 1))}>
          -
        </button>
        <input
          type="range"
          min={OFFER_MIN_PERCENT}
          max={OFFER_MAX_PERCENT}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-9 min-w-0 flex-1 accent-green-600"
          aria-label={label}
        />
        <button type="button" aria-label="Raise" className="h-9 w-9 shrink-0 rounded border border-zinc-700 text-lg" onClick={() => onChange(Math.min(OFFER_MAX_PERCENT, value + 1))}>
          +
        </button>
      </div>
      <div className="grid grid-cols-9 gap-1">
        {PERCENT_CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={clsx("rounded border py-1.5 text-xs tabular-nums", value === c ? "border-zinc-100 bg-zinc-100 font-semibold text-zinc-950" : "border-zinc-700")}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
const GRADERS = ["PSA", "BGS", "CGC", "TAG", "SGC"];

/** The confirm step after a lookup pick: check the match, set condition and amounts, then add it to the cart. */
function LookupConfirm({
  fill,
  offerPercent,
  rule,
  verb,
  onAdd,
  onEdit,
  onCancel,
}: {
  fill: LookupFill;
  offerPercent: number;
  rule: PricingRule;
  verb: string;
  onAdd: (item: IncomingItem) => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const [condition, setCondition] = useState("NM");
  const [grader, setGrader] = useState(fill.grader || "PSA");
  const [grade, setGrade] = useState(fill.grade);
  const [cert, setCert] = useState(fill.cert);
  const [qty, setQty] = useState(1);
  const [market, setMarketState] = useState(fill.marketCents);
  const [each, setEach] = useState<number | null>(fill.marketCents === null ? null : offerPrice(fill.marketCents, offerPercent, rule));
  const [eachTouched, setEachTouched] = useState(false);
  const [price, setPrice] = useState<number | null>(suggestPrice(fill.marketCents, rule));

  // the slider moves the offer until it is typed by hand
  useEffect(() => {
    if (!eachTouched && market !== null) setEach(offerPrice(market, offerPercent, rule));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerPercent]);

  function setMarket(m: number | null) {
    setMarketState(m);
    if (m === null) return;
    setEachTouched(false);
    setEach(offerPrice(m, offerPercent, rule));
    setPrice(suggestPrice(m, rule));
  }

  const ok = each !== null && qty >= 1;
  const detail = [fill.setName, fill.cardNumber && `#${fill.cardNumber}`, fill.variant].filter(Boolean).join(" · ");

  return (
    <div className="space-y-3 rounded-lg border-2 border-green-600 bg-zinc-900 p-3">
      <div className="text-xs font-semibold tracking-wide text-green-300 uppercase">Is this the card?</div>
      <div className="flex gap-3">
        {fill.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fill.photoUrl} alt="Your photo" className="h-28 w-20 shrink-0 rounded object-cover" />
        )}
        {fill.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fill.imageUrl} alt="Catalog image" className="h-28 w-20 shrink-0 rounded object-cover" />
        ) : (
          !fill.photoUrl && <div className="h-28 w-20 shrink-0 rounded bg-zinc-900" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold">{fill.name}</div>
          {detail && <div className="text-sm text-zinc-400">{detail}</div>}
          {fill.kind === "slab" && <div className="text-sm text-zinc-400">Slab</div>}
          {fill.kind === "sealed" && <div className="text-sm text-zinc-400">Sealed</div>}
          <div className="mt-1 text-sm">
            Market <b className="tabular-nums">{market === null ? "unknown" : money(market)}</b>
          </div>
        </div>
      </div>
      {fill.kind === "raw" && (
        <div className="flex gap-1">
          {CONDITIONS.map((c) => (
            <button key={c} type="button" onClick={() => setCondition(c)} className={clsx("flex-1 rounded border py-1.5 text-sm", condition === c ? "border-zinc-100 bg-zinc-100 text-zinc-950" : "border-zinc-700")}>
              {c}
            </button>
          ))}
        </div>
      )}
      {fill.kind === "slab" && (
        <div className="grid grid-cols-3 gap-2">
          <select className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2" value={grader} onChange={(e) => setGrader(e.target.value)}>
            {[...new Set([grader, ...GRADERS])].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <input className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2" placeholder="Grade" inputMode="decimal" value={grade} onChange={(e) => setGrade(e.target.value)} />
          <input className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2" placeholder="Cert" inputMode="numeric" value={cert} onChange={(e) => setCert(e.target.value)} />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 text-xs text-zinc-400">
        <label>
          Market each
          <MoneyInput cents={market} onChange={setMarket} />
        </label>
        <label>
          {verb} each ({offerPercent}%)
          <MoneyInput
            cents={each}
            onChange={(c) => {
              setEach(c);
              setEachTouched(true);
            }}
          />
        </label>
        <label>
          Sticker each
          <MoneyInput cents={price} onChange={setPrice} placeholder="later" />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">Qty</span>
        <button type="button" className="h-9 w-9 rounded border border-zinc-700 text-lg" onClick={() => setQty(Math.max(1, qty - 1))}>
          -
        </button>
        <span className="w-6 text-center tabular-nums">{qty}</span>
        <button type="button" className="h-9 w-9 rounded border border-zinc-700 text-lg" onClick={() => setQty(qty + 1)}>
          +
        </button>
        <button type="button" onClick={onEdit} className="ml-auto text-sm text-zinc-400 underline">
          Edit details
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-zinc-700 py-3 text-sm">
          Not it
        </button>
        <button
          type="button"
          disabled={!ok}
          onClick={() => {
            const product: ProductInput = {
              kind: fill.kind,
              name: fill.name.trim(),
              setName: fill.setName,
              cardNumber: fill.cardNumber,
              variant: fill.variant,
              condition: fill.kind === "raw" ? condition : "",
              grader: fill.kind === "slab" ? grader : "",
              grade: fill.kind === "slab" ? grade : "",
              cert: fill.kind === "slab" ? cert : "",
              marketCents: market,
            };
            onAdd({
              key: crypto.randomUUID(),
              product,
              qty,
              eachCents: each!,
              priceCents: price,
              offerAuto: market !== null && each === offerPrice(market, offerPercent, rule),
            });
          }}
          className="col-span-2 rounded-md bg-green-600 py-3 text-base font-semibold text-white active:bg-green-700 disabled:bg-zinc-700"
        >
          Add to cart {each !== null && money(each * qty)}
        </button>
      </div>
    </div>
  );
}

/**
 * The form for one incoming card. `offerPercent` of market is the default amount paid. A photo or
 * catalog pick opens a confirm step that adds straight to the cart, so a stack can be batched.
 */
export function IncomingForm({
  offerPercent,
  rule,
  onAdd,
  verb,
}: {
  offerPercent: number;
  rule: PricingRule;
  onAdd: (item: IncomingItem) => void;
  verb: string;
}) {
  const blank: ProductInput = { kind: "raw", name: "", setName: "", cardNumber: "", variant: "", condition: "NM", grader: "PSA", grade: "", cert: "", marketCents: null };
  const [p, setP] = useState<ProductInput>(blank);
  const [qty, setQty] = useState(1);
  const [each, setEach] = useState<number | null>(null);
  const [eachTouched, setEachTouched] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [matches, setMatches] = useState<PosProduct[]>([]);
  const [pending, setPending] = useState<{ id: number; fill: LookupFill } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  // a picked suggestion fills the name: don't open the list again for it
  const picked = useRef<string | null>(null);

  useEffect(() => {
    const q = p.name.trim().toLowerCase();
    if (q.length < 2 || p.name === picked.current) return setMatches([]);
    let live = true;
    void posDb()
      .products.filter((x) => `${x.name} ${x.setName} ${x.cardNumber}`.toLowerCase().includes(q))
      .limit(8)
      .toArray()
      .then((r) => live && setMatches(r));
    return () => {
      live = false;
    };
  }, [p.name]);

  // the slider moves the offer until it is typed by hand
  useEffect(() => {
    if (!eachTouched && p.marketCents !== null) setEach(offerPrice(p.marketCents, offerPercent, rule));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerPercent]);

  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(null), 4000);
    return () => clearTimeout(t);
  }, [added]);

  function setMarket(m: number | null) {
    setP((x) => ({ ...x, marketCents: m }));
    if (m !== null) {
      setEachTouched(false);
      setEach(offerPrice(m, offerPercent, rule));
      setPrice(suggestPrice(m, rule));
    }
  }

  function pick(m: PosProduct) {
    picked.current = m.name;
    setP({
      kind: m.kind,
      name: m.name,
      setName: m.setName,
      cardNumber: m.cardNumber,
      variant: m.variant,
      condition: m.condition || "NM",
      grader: m.grader || "PSA",
      grade: m.grade,
      cert: "",
      marketCents: m.marketCents,
    });
    setMatches([]);
    setMarket(m.marketCents);
  }

  /** "Edit details" from the confirm step: the pick goes into the full form. */
  function applyLookup(f: LookupFill) {
    picked.current = f.name;
    setMatches([]);
    setP((x) => ({
      ...x,
      kind: f.kind,
      name: f.name,
      setName: f.setName,
      cardNumber: f.cardNumber,
      variant: f.variant,
      grader: f.grader || x.grader,
      grade: f.grade,
      cert: f.cert,
      marketCents: f.marketCents,
    }));
    if (f.marketCents !== null) setMarket(f.marketCents);
    else {
      setEach(null);
      setPrice(null);
    }
  }

  function addItem(item: IncomingItem) {
    onAdd(item);
    setAdded(`Added ${item.qty > 1 ? `${item.qty} x ` : ""}${item.product.name}. Next card?`);
  }

  const ok = p.name.trim() && each !== null && qty >= 1;

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <CardLookup onFill={(fill) => setPending({ id: Date.now(), fill })} />
      {added && <div className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white">{added}</div>}
      {pending ? (
        <LookupConfirm
          key={pending.id}
          fill={pending.fill}
          offerPercent={offerPercent}
          rule={rule}
          verb={verb}
          onAdd={(item) => {
            setPending(null);
            addItem(item);
          }}
          onEdit={() => {
            applyLookup(pending.fill);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1 rounded-md bg-zinc-900 p-1 text-sm">
            {(["raw", "slab", "sealed"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setP({ ...p, kind: k })} className={clsx("rounded py-1.5", p.kind === k && "bg-zinc-900 font-medium shadow-sm")}>
                {k === "raw" ? "Raw" : k === "slab" ? "Slab" : "Sealed"}
              </button>
            ))}
          </div>
          <div className="relative">
            <input
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2"
              placeholder="Card or product name"
              value={p.name}
              onChange={(e) => setP({ ...p, name: e.target.value })}
            />
            {matches.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-auto rounded-md border border-zinc-800 bg-zinc-900 shadow-lg">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => pick(m)} className="w-full px-2 py-2 text-left text-sm hover:bg-zinc-800">
                      {m.name} <span className="text-zinc-400">{[m.setName, m.cardNumber && `#${m.cardNumber}`, m.grader && `${m.grader} ${m.grade}`, m.condition].filter(Boolean).join(" ")}</span>
                      {m.marketCents !== null && <span className="float-right tabular-nums">{money(m.marketCents)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {p.kind !== "sealed" && (
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2" placeholder="Set" value={p.setName} onChange={(e) => setP({ ...p, setName: e.target.value })} />
              <input className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2" placeholder="Number" value={p.cardNumber} onChange={(e) => setP({ ...p, cardNumber: e.target.value })} />
            </div>
          )}
          {p.kind === "raw" && (
            <div className="flex gap-1">
              {CONDITIONS.map((c) => (
                <button key={c} type="button" onClick={() => setP({ ...p, condition: c })} className={clsx("flex-1 rounded border py-1.5 text-sm", p.condition === c ? "border-zinc-100 bg-zinc-100 text-zinc-950" : "border-zinc-700")}>
                  {c}
                </button>
              ))}
            </div>
          )}
          {p.kind === "slab" && (
            <div className="grid grid-cols-3 gap-2">
              <select className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2" value={p.grader} onChange={(e) => setP({ ...p, grader: e.target.value })}>
                {GRADERS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
              <input className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2" placeholder="Grade" inputMode="decimal" value={p.grade} onChange={(e) => setP({ ...p, grade: e.target.value })} />
              <input className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2" placeholder="Cert" inputMode="numeric" value={p.cert} onChange={(e) => setP({ ...p, cert: e.target.value })} />
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 text-xs text-zinc-400">
            <label>
              Market each
              <MoneyInput cents={p.marketCents} onChange={setMarket} />
            </label>
            <label>
              {verb} each ({offerPercent}%)
              <MoneyInput
                cents={each}
                onChange={(c) => {
                  setEach(c);
                  setEachTouched(true);
                }}
              />
            </label>
            <label>
              Sticker each
              <MoneyInput cents={price} onChange={setPrice} placeholder="later" />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-400">Qty</span>
            <button type="button" className="h-9 w-9 rounded border border-zinc-700 text-lg" onClick={() => setQty(Math.max(1, qty - 1))}>
              -
            </button>
            <span className="w-6 text-center tabular-nums">{qty}</span>
            <button type="button" className="h-9 w-9 rounded border border-zinc-700 text-lg" onClick={() => setQty(qty + 1)}>
              +
            </button>
            <button
              type="button"
              disabled={!ok}
              onClick={() => {
                addItem({
                  key: crypto.randomUUID(),
                  product: { ...p, name: p.name.trim() },
                  qty,
                  eachCents: each!,
                  priceCents: price,
                  offerAuto: p.marketCents !== null && each === offerPrice(p.marketCents, offerPercent, rule),
                });
                picked.current = null;
                setP(blank);
                setQty(1);
                setEach(null);
                setEachTouched(false);
                setPrice(null);
              }}
              className="ml-auto rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 disabled:bg-zinc-700 disabled:text-zinc-400"
            >
              Add to cart
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function IncomingList({ items, onRemove, verb }: { items: IncomingItem[]; onRemove: (key: string) => void; verb: string }) {
  if (items.length === 0) return null;
  const cards = items.reduce((n, i) => n + i.qty, 0);
  const total = items.reduce((n, i) => n + i.eachCents * i.qty, 0);
  return (
    <ul className="rounded-lg border border-zinc-800 bg-zinc-900 px-3">
      <li className="flex justify-between border-b border-zinc-800 py-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
        <span>
          Cart · {cards} card{cards === 1 ? "" : "s"}
        </span>
        <span className="tabular-nums">{money(total)}</span>
      </li>
      {items.map((it) => (
        <li key={it.key} className="flex items-center gap-2 border-b border-zinc-800 py-2 last:border-0">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {it.qty > 1 && `${it.qty} x `}
              {it.product.name}
            </div>
            <div className="truncate text-xs text-zinc-400">
              {[it.product.setName, it.product.cardNumber && `#${it.product.cardNumber}`, it.product.kind === "slab" ? `${it.product.grader} ${it.product.grade}` : it.product.kind === "raw" ? it.product.condition : "Sealed"]
                .filter(Boolean)
                .join(" · ")}
              {it.product.marketCents !== null && ` · market ${money(it.product.marketCents)}`}
              {it.priceCents !== null && ` · sticker ${money(it.priceCents)}`}
            </div>
          </div>
          <div className="text-right text-sm tabular-nums">
            <div>{money(it.eachCents * it.qty)}</div>
            <div className="text-xs text-zinc-400">{verb}</div>
          </div>
          <button type="button" onClick={() => onRemove(it.key)} className="px-2 text-xl leading-none text-zinc-500" aria-label="Remove">
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Turns incoming items into one unit each, with fresh codes that are not on this phone already. */
export async function expandIncoming(items: IncomingItem[]) {
  const out: { unitId: string; code: string; product: ProductInput; costCents: number; priceCents: number | null }[] = [];
  const used = new Set<string>();
  for (const it of items) {
    for (let i = 0; i < it.qty; i++) {
      let code = newUnitCode();
      while (used.has(code) || (await posDb().units.where("code").equals(code).count()) > 0) code = newUnitCode();
      used.add(code);
      out.push({ unitId: crypto.randomUUID(), code, product: it.product, costCents: it.eachCents, priceCents: it.priceCents });
    }
  }
  return out;
}
