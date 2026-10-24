"use client";

import { useState } from "react";
import clsx from "clsx";
import { placeholderProduct, splitPile, type PlaceholderKind } from "@/lib/intake";
import { MoneyInput, money, type IncomingItem } from "./parts";

const KIND_LABEL: Record<PlaceholderKind, string> = { raw: "Card", slab: "Slab", sealed: "Sealed" };

function Count({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex flex-col items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
      {label}
      <span className="flex items-center">
        <button type="button" aria-label={`Fewer ${label}`} className="h-9 w-9 rounded border border-zinc-300 text-lg dark:border-zinc-700" onClick={() => onChange(Math.max(0, value - 1))}>
          -
        </button>
        <input
          inputMode="numeric"
          aria-label={label}
          value={value || ""}
          placeholder="0"
          onChange={(e) => onChange(Math.min(500, Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0)))}
          className="w-12 bg-transparent text-center text-lg tabular-nums text-zinc-900 outline-none dark:text-zinc-100"
        />
        <button type="button" aria-label={`More ${label}`} className="h-9 w-9 rounded border border-zinc-300 text-lg dark:border-zinc-700" onClick={() => onChange(Math.min(500, value + 1))}>
          +
        </button>
      </span>
    </label>
  );
}

/**
 * No time to look cards up at the table: take a pile in for one amount, or one quick item, as
 * placeholders. Each copy still gets its own code (so it can be sold); which card it is gets
 * filled in on the laptop after the show (Needs details).
 */
export function QuickIntake({ onAdd }: { onAdd: (items: IncomingItem[]) => void }) {
  const [mode, setMode] = useState<"pile" | "item" | null>(null);
  const [counts, setCounts] = useState<Record<PlaceholderKind, number>>({ raw: 0, slab: 0, sealed: 0 });
  const [total, setTotal] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<PlaceholderKind>("raw");
  const [each, setEach] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [hint, setHint] = useState("");

  const copies = counts.raw + counts.slab + counts.sealed;

  function reset() {
    setMode(null);
    setCounts({ raw: 0, slab: 0, sealed: 0 });
    setTotal(null);
    setNote("");
    setEach(null);
    setQty(1);
    setHint("");
  }

  function addPile() {
    const parts = splitPile(counts, total!);
    onAdd(
      parts.map((p) => ({
        key: crypto.randomUUID(),
        product: placeholderProduct(p.kind),
        qty: p.costs.length,
        eachCents: Math.round(p.costs.reduce((a, b) => a + b, 0) / p.costs.length),
        costs: p.costs,
        priceCents: null,
        pending: true,
        note: note.trim(),
      })),
    );
    reset();
  }

  function addItem() {
    onAdd([{ key: crypto.randomUUID(), product: placeholderProduct(kind, hint), qty, eachCents: each!, priceCents: null, pending: true, note: "" }]);
    reset();
  }

  if (mode === null) {
    return (
      <div className="grid grid-cols-2 gap-2 text-sm">
        <button type="button" onClick={() => setMode("pile")} className="rounded-md border border-zinc-300 bg-white py-2 dark:border-zinc-700 dark:bg-zinc-900">
          + Pile, one price
        </button>
        <button type="button" onClick={() => setMode("item")} className="rounded-md border border-zinc-300 bg-white py-2 dark:border-zinc-700 dark:bg-zinc-900">
          + Quick item
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{mode === "pile" ? "A pile for one price" : "One quick item"}</span>
        <button type="button" onClick={reset} className="text-sm text-zinc-500 dark:text-zinc-400">
          Cancel
        </button>
      </div>
      {mode === "pile" ? (
        <>
          <div className="grid grid-cols-3 gap-1">
            <Count label="Cards" value={counts.raw} onChange={(n) => setCounts({ ...counts, raw: n })} />
            <Count label="Slabs" value={counts.slab} onChange={(n) => setCounts({ ...counts, slab: n })} />
            <Count label="Sealed" value={counts.sealed} onChange={(n) => setCounts({ ...counts, sealed: n })} />
          </div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">
            Total for the pile
            <MoneyInput cents={total} onChange={setTotal} />
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Note (optional): binder of Eeveelutions"
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            disabled={copies === 0 || total === null}
            onClick={addPile}
            className="w-full rounded-md bg-green-600 py-3 font-semibold text-white disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
          >
            Add {copies || ""} {copies === 1 ? "item" : "items"} {total !== null && `for ${money(total)}`}
          </button>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1 rounded-md bg-zinc-100 p-1 text-sm dark:bg-zinc-800">
            {(["raw", "slab", "sealed"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={clsx("rounded py-1.5", kind === k && "bg-white font-medium shadow-sm dark:bg-zinc-900")}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <input
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            maxLength={200}
            placeholder="What is it? (optional, e.g. Charizard PSA 9)"
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">
              Amount each
              <MoneyInput cents={each} onChange={setEach} />
            </label>
            <Count label="Qty" value={qty} onChange={(n) => setQty(Math.max(1, n))} />
          </div>
          <button
            type="button"
            disabled={each === null}
            onClick={addItem}
            className="w-full rounded-md bg-green-600 py-3 font-semibold text-white disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
          >
            Add {each !== null && money(each * qty)}
          </button>
        </>
      )}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">Each copy gets a code now and can be sold; say which card it is on the laptop after the show (Needs details).</p>
    </div>
  );
}
