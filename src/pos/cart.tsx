"use client";

import { useCallback, useRef, useState } from "react";
import { extractCode } from "@/lib/codes";
import { posDb } from "./db";
import { Scanner, beep } from "./scanner";
import { UnitRow, money } from "./parts";
import type { PosUnit } from "./types";

export type Flash = { tone: "ok" | "warn" | "error"; text: string } | null;

/** Why add() did or did not put a card in the cart. Only "unknown" is worth a name search. */
export type AddResult = "added" | "invalid" | "unknown" | "unavailable" | "duplicate";

const STATUS_TEXT: Record<string, string> = { sold: "already SOLD", traded_out: "already TRADED", removed: "removed from stock" };

/** The cards leaving the table: add by scanning, typing a code, or searching a name. */
export function useCart() {
  const [lines, setLinesState] = useState<PosUnit[]>([]);
  const [flash, setFlash] = useState<Flash>(null);
  // the scanner calls add() from a timer: read the cart from a ref, not a stale render
  const linesRef = useRef<PosUnit[]>([]);
  const setLines = useCallback((next: (ls: PosUnit[]) => PosUnit[]) => {
    linesRef.current = next(linesRef.current);
    setLinesState(linesRef.current);
  }, []);

  const add = useCallback(async (raw: string): Promise<AddResult> => {
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
    setFlash({ tone: "ok", text: `${u.name} ${u.priceCents === null ? "(no price)" : money(u.priceCents)}` });
    return "added";
  }, [setLines]);

  const addUnit = useCallback((u: PosUnit) => {
    setLines((ls) => (ls.some((l) => l.id === u.id) ? ls : [...ls, u]));
    setFlash({ tone: "ok", text: `${u.name} added` });
  }, [setLines]);

  const remove = (id: string) => setLines((ls) => ls.filter((l) => l.id !== id));
  const clear = () => {
    setLines(() => []);
    setFlash(null);
  };
  /** what the cards are worth at their sticker (or market if unpriced) */
  const stickerTotal = lines.reduce((n, l) => n + (l.priceCents ?? l.marketCents ?? 0), 0);
  return { lines, add, addUnit, remove, clear, flash, setFlash, stickerTotal };
}

export type Cart = ReturnType<typeof useCart>;

export function CartEntry({ cart, scanning, setScanning }: { cart: Cart; scanning: boolean; setScanning: (s: boolean) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PosUnit[]>([]);

  async function submit() {
    const text = q.trim();
    if (!text) return;
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
      .limit(15)
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
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2"
          autoCapitalize="characters"
        />
        <button className="rounded-md border border-zinc-300 bg-white px-3 text-sm">Find</button>
        <button type="button" onClick={() => setScanning(!scanning)} className="rounded-md border border-zinc-300 bg-white px-3 text-sm">
          {scanning ? "Hide cam" : "Camera"}
        </button>
      </form>
      {results.length > 0 && (
        <ul className="rounded-lg border border-zinc-200 bg-white px-3">
          {results.map((u) => (
            <li key={u.id} className="flex items-center">
              <div className="flex-1">
                <UnitRow u={u} right={<span className="text-sm tabular-nums">{u.priceCents === null ? "-" : money(u.priceCents)}</span>} />
              </div>
              <button
                type="button"
                className="ml-2 rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white"
                onClick={() => {
                  cart.addUnit(u);
                  setResults([]);
                  setQ("");
                }}
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CartList({ cart }: { cart: Cart }) {
  if (cart.lines.length === 0) return null;
  return (
    <ul className="rounded-lg border border-zinc-200 bg-white px-3">
      {cart.lines.map((u) => (
        <UnitRow
          key={u.id}
          u={u}
          onRemove={() => cart.remove(u.id)}
          right={<span className="text-sm tabular-nums">{u.priceCents === null ? <span className="text-amber-600">no price</span> : money(u.priceCents)}</span>}
        />
      ))}
    </ul>
  );
}
