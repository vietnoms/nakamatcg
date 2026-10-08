"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { newUnitCode } from "@/lib/codes";
import { formatCents, parseDollars } from "@/lib/money";
import type { ProductInput } from "@/lib/ops";
import { roundPrice, suggestPrice, type PricingRule } from "@/lib/pricing";
import type { PaymentMethod } from "@/lib/settings";
import { posDb } from "./db";
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
    <div className={clsx("flex items-center rounded-md border border-zinc-300 bg-white px-2 focus-within:border-zinc-900", className)}>
      <span className="text-zinc-400">$</span>
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
            value === m.id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-800",
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
}: {
  methods: PaymentMethod[];
  totalCents: number;
  onChange: (p: { method: string; amountCents: number }[] | null) => void;
  label: string;
}) {
  const [first, setFirst] = useState<string | null>(methods[0]?.id ?? null);
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
        <label className="flex items-center gap-1.5 text-zinc-600">
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Split
        </label>
      </div>
      <MethodPicker methods={methods} value={first} onChange={setFirst} />
      {split && (
        <div className="space-y-2 rounded-md bg-zinc-100 p-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-24">{methods.find((m) => m.id === first)?.label}</span>
            <MoneyInput cents={firstAmount} onChange={setFirstAmount} className="flex-1" />
          </div>
          <div className="text-xs text-zinc-500">Rest ({money(Math.max(0, totalCents - (firstAmount ?? 0)))}) by:</div>
          <MethodPicker methods={methods.filter((m) => m.id !== first)} value={second} onChange={setSecond} />
        </div>
      )}
    </div>
  );
}

export function UnitRow({ u, right, onRemove }: { u: Pick<PosUnit, "name" | "setName" | "cardNumber" | "badge" | "code">; right?: React.ReactNode; onRemove?: () => void }) {
  return (
    <li className="flex items-center gap-2 border-b border-zinc-100 py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {u.name} {u.badge && <span className="rounded bg-zinc-100 px-1 text-xs text-zinc-600">{u.badge}</span>}
        </div>
        <div className="truncate text-xs text-zinc-500">
          <span className="font-mono">{u.code}</span> {[u.setName, u.cardNumber && `#${u.cardNumber}`].filter(Boolean).join(" ")}
        </div>
      </div>
      {right}
      {onRemove && (
        <button type="button" onClick={onRemove} className="px-2 text-xl leading-none text-zinc-400" aria-label="Remove">
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
};

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
const GRADERS = ["PSA", "BGS", "CGC", "TAG", "SGC"];

/** The form for one incoming card. `offerPercent` of market is the default amount paid. */
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
  const [price, setPrice] = useState<number | null>(null);
  const [matches, setMatches] = useState<PosProduct[]>([]);
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

  function setMarket(m: number | null) {
    setP((x) => ({ ...x, marketCents: m }));
    if (m !== null) {
      setEach(roundPrice(Math.round((m * offerPercent) / 100), { ...rule, mode: "down", minCents: 0 }));
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

  const ok = p.name.trim() && each !== null && qty >= 1;

  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
      <div className="grid grid-cols-3 gap-1 rounded-md bg-zinc-100 p-1 text-sm">
        {(["raw", "slab", "sealed"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setP({ ...p, kind: k })} className={clsx("rounded py-1.5", p.kind === k && "bg-white font-medium shadow-sm")}>
            {k === "raw" ? "Raw" : k === "slab" ? "Slab" : "Sealed"}
          </button>
        ))}
      </div>
      <div className="relative">
        <input
          className="w-full rounded-md border border-zinc-300 px-2 py-2"
          placeholder="Card or product name"
          value={p.name}
          onChange={(e) => setP({ ...p, name: e.target.value })}
        />
        {matches.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-auto rounded-md border border-zinc-200 bg-white shadow-lg">
            {matches.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => pick(m)} className="w-full px-2 py-2 text-left text-sm hover:bg-zinc-50">
                  {m.name} <span className="text-zinc-500">{[m.setName, m.cardNumber && `#${m.cardNumber}`, m.grader && `${m.grader} ${m.grade}`, m.condition].filter(Boolean).join(" ")}</span>
                  {m.marketCents !== null && <span className="float-right tabular-nums">{money(m.marketCents)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {p.kind !== "sealed" && (
        <div className="grid grid-cols-2 gap-2">
          <input className="rounded-md border border-zinc-300 px-2 py-2" placeholder="Set" value={p.setName} onChange={(e) => setP({ ...p, setName: e.target.value })} />
          <input className="rounded-md border border-zinc-300 px-2 py-2" placeholder="Number" value={p.cardNumber} onChange={(e) => setP({ ...p, cardNumber: e.target.value })} />
        </div>
      )}
      {p.kind === "raw" && (
        <div className="flex gap-1">
          {CONDITIONS.map((c) => (
            <button key={c} type="button" onClick={() => setP({ ...p, condition: c })} className={clsx("flex-1 rounded border py-1.5 text-sm", p.condition === c ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300")}>
              {c}
            </button>
          ))}
        </div>
      )}
      {p.kind === "slab" && (
        <div className="grid grid-cols-3 gap-2">
          <select className="rounded-md border border-zinc-300 px-2 py-2" value={p.grader} onChange={(e) => setP({ ...p, grader: e.target.value })}>
            {GRADERS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <input className="rounded-md border border-zinc-300 px-2 py-2" placeholder="Grade" inputMode="decimal" value={p.grade} onChange={(e) => setP({ ...p, grade: e.target.value })} />
          <input className="rounded-md border border-zinc-300 px-2 py-2" placeholder="Cert" inputMode="numeric" value={p.cert} onChange={(e) => setP({ ...p, cert: e.target.value })} />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 text-xs text-zinc-500">
        <label>
          Market each
          <MoneyInput cents={p.marketCents} onChange={setMarket} />
        </label>
        <label>
          {verb} each
          <MoneyInput cents={each} onChange={setEach} />
        </label>
        <label>
          Sticker each
          <MoneyInput cents={price} onChange={setPrice} placeholder="later" />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-600">Qty</span>
        <button type="button" className="h-9 w-9 rounded border border-zinc-300 text-lg" onClick={() => setQty(Math.max(1, qty - 1))}>
          -
        </button>
        <span className="w-6 text-center tabular-nums">{qty}</span>
        <button type="button" className="h-9 w-9 rounded border border-zinc-300 text-lg" onClick={() => setQty(qty + 1)}>
          +
        </button>
        <button
          type="button"
          disabled={!ok}
          onClick={() => {
            onAdd({ key: crypto.randomUUID(), product: { ...p, name: p.name.trim() }, qty, eachCents: each!, priceCents: price });
            setP(blank);
            setQty(1);
            setEach(null);
            setPrice(null);
          }}
          className="ml-auto rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-300"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function IncomingList({ items, onRemove, verb }: { items: IncomingItem[]; onRemove: (key: string) => void; verb: string }) {
  if (items.length === 0) return null;
  return (
    <ul className="rounded-lg border border-zinc-200 bg-white px-3">
      {items.map((it) => (
        <li key={it.key} className="flex items-center gap-2 border-b border-zinc-100 py-2 last:border-0">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {it.qty > 1 && `${it.qty} x `}
              {it.product.name}
            </div>
            <div className="truncate text-xs text-zinc-500">
              {[it.product.setName, it.product.cardNumber && `#${it.product.cardNumber}`, it.product.kind === "slab" ? `${it.product.grader} ${it.product.grade}` : it.product.kind === "raw" ? it.product.condition : "Sealed"]
                .filter(Boolean)
                .join(" · ")}
              {it.priceCents !== null && ` · sticker ${money(it.priceCents)}`}
            </div>
          </div>
          <div className="text-right text-sm tabular-nums">
            <div>{money(it.eachCents * it.qty)}</div>
            <div className="text-xs text-zinc-500">{verb}</div>
          </div>
          <button type="button" onClick={() => onRemove(it.key)} className="px-2 text-xl leading-none text-zinc-400" aria-label="Remove">
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
