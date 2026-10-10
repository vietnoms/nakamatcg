"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { extractCode } from "@/lib/codes";
import { posDb } from "./db";
import { Scanner, beep } from "./scanner";
import { UnitRow, money } from "./parts";
import type { PosUnit } from "./types";

export type Flash = { tone: "ok" | "warn" | "error"; text: string } | null;

/** Why add() did or did not put a card in the cart. Only "unknown" is worth a name search. */
export type AddResult = "added" | "invalid" | "unknown" | "unavailable" | "duplicate";

const STATUS_TEXT: Record<string, string> = { sold: "already SOLD", traded_out: "already TRADED", removed: "removed from stock" };

/**
 * The cards leaving the table: add by scanning, typing a code, or searching a name. With a
 * storage key the cart is kept on the phone (ids only; each card is re-read from the inventory
 * on load, so a card sold meanwhile drops out) and shared between tabs.
 */
export function useCart(storageKey?: string) {
  const [lines, setLinesState] = useState<PosUnit[]>([]);
  const [flash, setFlash] = useState<Flash>(null);
  // the scanner calls add() from a timer: read the cart from a ref, not a stale render
  const linesRef = useRef<PosUnit[]>([]);
  // adds wait for the saved cart to load, so a scan that opened the POS lands in the same cart
  const ready = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (ready.current === null) {
    let resolve = () => {};
    const promise = new Promise<void>((r) => (resolve = r));
    ready.current = { promise, resolve };
  }

  const setLines = useCallback(
    (next: (ls: PosUnit[]) => PosUnit[]) => {
      linesRef.current = next(linesRef.current);
      setLinesState(linesRef.current);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(linesRef.current.map((l) => l.id)));
        } catch {
          // storage blocked: the cart still works on this page
        }
      }
    },
    [storageKey],
  );

  useEffect(() => {
    if (!storageKey) {
      ready.current?.resolve();
      return;
    }
    const restore = async () => {
      let ids: string[] = [];
      try {
        ids = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as string[];
      } catch {
        ids = [];
      }
      const found = await posDb().units.bulkGet(ids);
      const keep = found.filter((u): u is PosUnit => Boolean(u) && u!.status === "in_stock");
      linesRef.current = keep;
      setLinesState(keep);
      if (keep.length < ids.length) {
        setFlash({ tone: "warn", text: `${ids.length - keep.length} card(s) left the cart: sold or no longer in stock` });
      }
    };
    void restore().finally(() => ready.current?.resolve());
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey) void restore();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const add = useCallback(
    async (raw: string): Promise<AddResult> => {
      await ready.current?.promise;
      const code = extractCode(raw);
      if (!code) {
        beep(false);
        setFlash({ tone: "error", text: "Not one of our stickers" });
        return "invalid";
      }
      const u = await posDb().units.where("code").equals(code).first();
      if (!u) {
        beep(false);
        setFlash({ tone: "error", text: `${code} is not in this phone's inventory. Sync, or search by name.` });
        return "unknown";
      }
      if (u.status !== "in_stock") {
        beep(false);
        setFlash({ tone: "error", text: `${u.name} (${code}) is ${STATUS_TEXT[u.status] ?? u.status}` });
        return "unavailable";
      }
      if (linesRef.current.some((l) => l.id === u.id)) {
        setFlash({ tone: "warn", text: `${u.name} is already in the cart` });
        return "duplicate";
      }
      setLines((ls) => [...ls, u]);
      beep(true);
      setFlash({ tone: "ok", text: `Added ${u.name} ${u.priceCents === null ? "(no price)" : money(u.priceCents)}` });
      return "added";
    },
    [setLines],
  );

  const addUnit = useCallback(
    (u: PosUnit) => {
      setLines((ls) => (ls.some((l) => l.id === u.id) ? ls : [...ls, u]));
      setFlash({ tone: "ok", text: `Added ${u.name}` });
    },
    [setLines],
  );

  /** Several copies at once (sealed by quantity). Copies already in the cart are skipped. */
  const addMany = useCallback(
    (us: PosUnit[]) => {
      const fresh = us.filter((u) => !linesRef.current.some((l) => l.id === u.id));
      if (fresh.length === 0) return;
      setLines((ls) => [...ls, ...fresh]);
      beep(true);
      setFlash({ tone: "ok", text: `Added ${fresh.length > 1 ? `${fresh.length} x ` : ""}${fresh[0]!.name}` });
    },
    [setLines],
  );

  const remove = (id: string) => setLines((ls) => ls.filter((l) => l.id !== id));
  const clear = () => {
    setLines(() => []);
    setFlash(null);
  };
  /** what the cards are worth at their sticker (or market if unpriced) */
  const stickerTotal = lines.reduce((n, l) => n + (l.priceCents ?? l.marketCents ?? 0), 0);
  return { lines, add, addUnit, addMany, remove, clear, flash, setFlash, stickerTotal };
}

export type Cart = ReturnType<typeof useCart>;

/** In-stock copies of one product at one price, minus those already in the cart. */
type Pick = { key: string; units: PosUnit[] };

function groupUnits(us: PosUnit[], inCart: Set<string>): Pick[] {
  const by = new Map<string, PosUnit[]>();
  for (const u of us) {
    if (inCart.has(u.id)) continue;
    const k = `${u.productId}|${u.priceCents ?? "-"}`;
    by.set(k, [...(by.get(k) ?? []), u]);
  }
  return [...by.entries()].map(([key, units]) => ({ key, units }));
}

/** One product in the search or Sealed list: how many are left, a quantity, and Add. */
function PickRow({ pick, onAdd }: { pick: Pick; onAdd: (us: PosUnit[]) => void }) {
  const [n, setN] = useState(1);
  const u = pick.units[0]!;
  const left = pick.units.length;
  return (
    <li className="flex items-center gap-2 border-b border-zinc-100 py-2 last:border-0 dark:border-zinc-800">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {u.name} {u.badge && <span className="rounded bg-zinc-100 px-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{u.badge}</span>}
        </div>
        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {left} in stock · {u.priceCents === null ? <span className="text-amber-600 dark:text-amber-400">no price</span> : money(u.priceCents)}
          {left === 1 && <span className="font-mono"> · {u.code}</span>}
        </div>
      </div>
      {left > 1 && (
        <div className="flex items-center">
          <button type="button" aria-label="Fewer" className="h-8 w-8 rounded border border-zinc-300 dark:border-zinc-700" onClick={() => setN(Math.max(1, n - 1))}>
            -
          </button>
          <span className="w-7 text-center tabular-nums">{n}</span>
          <button type="button" aria-label="More" className="h-8 w-8 rounded border border-zinc-300 dark:border-zinc-700" onClick={() => setN(Math.min(left, n + 1))}>
            +
          </button>
        </div>
      )}
      <button
        type="button"
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-950"
        onClick={() => {
          onAdd(pick.units.slice(0, n));
          setN(1);
        }}
      >
        Add{n > 1 ? ` ${n}` : ""}
      </button>
    </li>
  );
}

export function CartEntry({ cart, scanning, setScanning }: { cart: Cart; scanning: boolean; setScanning: (s: boolean) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PosUnit[]>([]);
  const [sealedOpen, setSealedOpen] = useState(false);
  const [sealed, setSealed] = useState<PosUnit[]>([]);

  const inCart = new Set(cart.lines.map((l) => l.id));
  const picks = groupUnits(results, inCart);
  const sealedPicks = groupUnits(sealed, inCart).sort((a, b) => a.units[0]!.name.localeCompare(b.units[0]!.name));

  async function openSealed() {
    if (sealedOpen) return setSealedOpen(false);
    setResults([]);
    setSealed(await posDb().units.where("status").equals("in_stock").filter((u) => u.kind === "sealed").toArray());
    setSealedOpen(true);
  }

  async function submit() {
    const text = q.trim();
    if (!text) return;
    setSealedOpen(false);
    if (extractCode(text)) {
      // clear right away so the next typed or scanned code starts fresh; put it back if it failed
      setQ("");
      setResults([]);
      const r = await cart.add(text);
      if (r !== "unknown") {
        if (r !== "added") setQ(text);
        return;
      }
      // six letters can be a code or the start of a name: an unknown code falls back to a name search
      setQ(text);
    }
    const needle = text.toLowerCase();
    const found = await posDb()
      .units.where("status")
      .equals("in_stock")
      .filter((u) => `${u.name} ${u.setName} ${u.cardNumber}`.toLowerCase().includes(needle))
      .limit(300)
      .toArray();
    setResults(found);
    cart.setFlash(found.length === 0 ? { tone: "error", text: `Nothing in stock matches "${text}"` } : null);
  }

  const tone = { ok: "bg-green-600", warn: "bg-amber-500", error: "bg-red-600" };
  return (
    <div className="space-y-2">
      {scanning && <Scanner active={scanning} onScan={(t) => void cart.add(t)} />}
      {cart.flash && <div className={`rounded-md px-3 py-2 text-sm font-medium text-white ${tone[cart.flash.tone]}`}>{cart.flash.text}</div>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Sticker code or card name"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          autoCapitalize="characters"
        />
        <button className="rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">Find</button>
        <button
          type="button"
          onClick={() => void openSealed()}
          className={`rounded-md border px-3 text-sm ${sealedOpen ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950" : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"}`}
        >
          Sealed
        </button>
        <button type="button" onClick={() => setScanning(!scanning)} className="rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          {scanning ? "Hide cam" : "Camera"}
        </button>
      </form>
      {sealedOpen && (
        <ul className="max-h-80 overflow-auto rounded-lg border border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-900">
          {sealedPicks.length === 0 && <li className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">No sealed in stock{sealed.length ? " that isn't already in the cart" : ""}.</li>}
          {sealedPicks.map((p) => (
            <PickRow key={p.key} pick={p} onAdd={(us) => cart.addMany(us)} />
          ))}
        </ul>
      )}
      {picks.length > 0 && (
        <ul className="rounded-lg border border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-900">
          {picks.slice(0, 20).map((p) => (
            <PickRow
              key={p.key}
              pick={p}
              onAdd={(us) => {
                cart.addMany(us);
                setResults([]);
                setQ("");
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The cart, with copies of one product at one price on one line ("3 x Booster Bundle"). */
export function CartList({ cart }: { cart: Cart }) {
  if (cart.lines.length === 0) return null;
  const groups = new Map<string, PosUnit[]>();
  for (const u of cart.lines) {
    const k = `${u.productId}|${u.priceCents ?? "-"}`;
    groups.set(k, [...(groups.get(k) ?? []), u]);
  }
  return (
    <ul className="rounded-lg border border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-900">
      {[...groups.values()].map((us) => {
        const u = us[us.length - 1]!;
        const n = us.length;
        return (
          <UnitRow
            key={u.id}
            u={n > 1 ? { ...u, name: `${n} x ${u.name}`, code: us.length > 3 ? `${n} copies` : us.map((x) => x.code).join(" ") } : u}
            onRemove={() => cart.remove(u.id)}
            right={
              <span className="text-sm tabular-nums">
                {u.priceCents === null ? <span className="text-amber-600 dark:text-amber-400">no price</span> : money(u.priceCents * n)}
              </span>
            }
          />
        );
      })}
    </ul>
  );
}
