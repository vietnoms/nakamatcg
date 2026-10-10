"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Badge, Button, Input, Select } from "@/components/ui";
import { badgeFor } from "@/import/collectr";
import { formatCents, parseDollars } from "@/lib/money";
import { suggestPrice, type PricingRule } from "@/lib/pricing";
import type { PricingRow } from "@/server/inventory";
import Link from "next/link";
import { moveToPc, savePrice, savePrices } from "./actions";

type Filter = "all" | "unpriced" | "priced";
type Sort = "set" | "market-desc" | "market-asc" | "name";

const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2).replace(/\.00$/, ""));

export function PricingTable({ rows: initial, rule }: { rows: PricingRow[]; rule: PricingRule }) {
  const [rows, setRows] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, "saving" | "error">>({});
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("unpriced");
  const [kind, setKind] = useState("");
  const [set, setSet] = useState("");
  const [sort, setSort] = useState<Sort>("set");
  const [bulkPending, startBulk] = useTransition();
  // cards just moved to the PC: hidden here, with a link to where they went
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [pcNote, setPcNote] = useState<{ text: string; groupId: string } | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  // Enter moves focus on, which blurs the row it just saved: that blur must not save again
  const skipBlur = useRef<string | null>(null);

  const sets = useMemo(() => [...new Set(initial.map((r) => r.setName))].sort(), [initial]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (filter === "all" || (filter === "unpriced" ? r.priceCents === null : r.priceCents !== null)) &&
        (!kind || r.kind === kind) &&
        (!set || r.setName === set) &&
        (!needle || `${r.name} ${r.setName} ${r.cardNumber}`.toLowerCase().includes(needle)),
    );
    const m = (r: PricingRow) => r.marketCents ?? -1;
    if (sort === "market-desc") list.sort((a, b) => m(b) - m(a));
    else if (sort === "market-asc") list.sort((a, b) => m(a) - m(b));
    else if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
    // the list is filtered once per filter change, not on every save, so a just-priced row stays put
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filter, kind, set, sort, initial]);

  const totals = useMemo(() => {
    const live = rows.filter((r) => !gone.has(r.productId));
    return {
      unpriced: live.filter((r) => r.priceCents === null).reduce((n, r) => n + r.inStock, 0),
      copies: live.reduce((n, r) => n + r.inStock, 0),
    };
  }, [rows, gone]);

  async function toPc(r: PricingRow) {
    if (!confirm(`Move ${r.inStock === 1 ? "" : `all ${r.inStock} copies of `}${r.name} to your PC? It comes off pricing, stickers and the POS.`)) return;
    try {
      const res = await moveToPc(r.productId);
      const left = r.inStock - res.moved;
      if (left > 0) setRows((rs) => rs.map((x) => (x.productId === r.productId ? { ...x, inStock: left } : x)));
      else setGone((g) => new Set(g).add(r.productId));
      setPcNote({ text: `${r.name}: ${res.moved} cop${res.moved === 1 ? "y" : "ies"} moved to your PC${left > 0 ? ` (${left} consigned stay)` : ""}.`, groupId: res.groupId });
    } catch (e) {
      setPcNote({ text: e instanceof Error ? e.message : "Could not move it", groupId: "" });
    }
  }

  function focusAt(i: number) {
    const next = visible[i];
    if (!next) return;
    const el = inputs.current.get(next.productId);
    el?.focus();
    el?.select();
  }

  async function commit(row: PricingRow, index: number, advance: boolean) {
    const text = drafts[row.productId];
    let cents: number | null;
    if (text === undefined || text.trim() === "") {
      cents = row.priceCents ?? suggestPrice(row.marketCents, rule);
    } else {
      cents = parseDollars(text);
      if (cents === null) {
        setSaving((s) => ({ ...s, [row.productId]: "error" }));
        return;
      }
    }
    if (advance) {
      skipBlur.current = row.productId;
      focusAt(index + 1);
    }
    if (cents === row.priceCents) return;

    setSaving((s) => ({ ...s, [row.productId]: "saving" }));
    setRows((rs) => rs.map((r) => (r.productId === row.productId ? { ...r, priceCents: cents, mixedPrices: false } : r)));
    setDrafts((d) => {
      const { [row.productId]: _, ...rest } = d;
      return rest;
    });
    try {
      await savePrice(row.productId, cents);
      setSaving(({ [row.productId]: _, ...rest }) => rest);
    } catch {
      setSaving((s) => ({ ...s, [row.productId]: "error" }));
    }
  }

  function acceptAllSuggested() {
    const todo = visible
      .filter((r) => r.priceCents === null)
      .map((r) => ({ productId: r.productId, priceCents: suggestPrice(r.marketCents, rule) }))
      .filter((p): p is { productId: string; priceCents: number } => p.priceCents !== null);
    if (todo.length === 0) return;
    if (!confirm(`Set the suggested price on ${todo.length} unpriced cards in this view?`)) return;
    startBulk(async () => {
      await savePrices(todo);
      const by = new Map(todo.map((t) => [t.productId, t.priceCents]));
      setRows((rs) => rs.map((r) => (by.has(r.productId) ? { ...r, priceCents: by.get(r.productId)! } : r)));
    });
  }

  /** Every card in view (priced or not) to its market price, rounded by the pricing rule. */
  function repriceAllToMarket() {
    const current = new Map(rows.map((r) => [r.productId, r]));
    const inView = visible.filter((v) => !gone.has(v.productId)).map((v) => current.get(v.productId) ?? v);
    const todo = inView
      .map((r) => ({ productId: r.productId, priceCents: suggestPrice(r.marketCents, rule), was: r.priceCents, mixed: r.mixedPrices }))
      .filter((p): p is { productId: string; priceCents: number; was: number | null; mixed: boolean } => p.priceCents !== null && (p.priceCents !== p.was || p.mixed));
    const noMarket = inView.filter((r) => r.marketCents === null).length;
    if (todo.length === 0) {
      alert(noMarket ? `Nothing to change: the ${noMarket} card(s) without a market price stay as they are.` : "Every card in view is already at market.");
      return;
    }
    const repriced = todo.filter((t) => t.was !== null).length;
    if (
      !confirm(
        `Set ${todo.length} card${todo.length === 1 ? "" : "s"} in this view to market (${rule.percent}% of market, rounded as in Settings)?` +
          (repriced ? `\n\n${repriced} already had a price; their stickers go back in the print queue.` : "") +
          (noMarket ? `\n${noMarket} without a market price are left alone.` : ""),
      )
    )
      return;
    startBulk(async () => {
      await savePrices(todo.map(({ productId, priceCents }) => ({ productId, priceCents })));
      const by = new Map(todo.map((t) => [t.productId, t.priceCents]));
      setRows((rs) => rs.map((r) => (by.has(r.productId) ? { ...r, priceCents: by.get(r.productId)!, mixedPrices: false } : r)));
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search name, set, number" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="unpriced">Unpriced</option>
          <option value="priced">Priced</option>
          <option value="all">All</option>
        </Select>
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Raw, slabs, sealed</option>
          <option value="raw">Raw</option>
          <option value="slab">Slabs</option>
          <option value="sealed">Sealed</option>
        </Select>
        <Select value={set} onChange={(e) => setSet(e.target.value)} className="max-w-56">
          <option value="">All sets</option>
          {sets.map((s) => (
            <option key={s} value={s}>
              {s || "(no set)"}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="set">Sort: set, then name</option>
          <option value="market-desc">Sort: most valuable first</option>
          <option value="market-asc">Sort: cheapest first</option>
          <option value="name">Sort: name</option>
        </Select>
        <Button variant="secondary" onClick={acceptAllSuggested} disabled={bulkPending}>
          {bulkPending ? "Saving..." : "Accept suggested for unpriced in view"}
        </Button>
        <Button variant="secondary" onClick={repriceAllToMarket} disabled={bulkPending} title="Every card in view, priced or not, to its market price (rounded by your pricing rule)">
          Set all in view to market
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-green-600 transition-all"
            style={{ width: `${totals.copies ? Math.round(((totals.copies - totals.unpriced) * 100) / totals.copies) : 0}%` }}
          />
        </div>
        <span className="shrink-0 text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
          {totals.copies - totals.unpriced} of {totals.copies} copies priced
        </span>
      </div>

      {pcNote && (
        <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
          {pcNote.text}{" "}
          {pcNote.groupId && (
            <Link href={`/groups/${pcNote.groupId}`} className="font-medium underline">
              Open PC
            </Link>
          )}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-950 text-left text-xs text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="p-2">Card</th>
              <th className="p-2 text-right">Qty</th>
              <th className="p-2 text-right">Cost</th>
              <th className="p-2 text-right">Market</th>
              <th className="p-2 text-right">Suggested</th>
              <th className="w-32 p-2 text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((v, i) => {
              if (gone.has(v.productId)) return null;
              const r = rows.find((x) => x.productId === v.productId) ?? v;
              const suggested = suggestPrice(r.marketCents, rule);
              const state = saving[r.productId];
              const badge = badgeFor(r);
              return (
                <tr key={r.productId} className="border-t border-zinc-200 dark:border-zinc-800 align-middle">
                  <td className="p-2">
                    <div className="font-medium">
                      {r.name} {badge && <Badge tone={r.kind === "slab" ? "blue" : "zinc"}>{badge}</Badge>}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      {[r.setName, r.cardNumber && `#${r.cardNumber}`, r.variant].filter(Boolean).join(" · ")}
                      <button
                        type="button"
                        onClick={() => void toPc(r)}
                        title="Keep it: personal collection, not for sale"
                        className="ml-2 rounded border border-zinc-300 px-1.5 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      >
                        Move to PC
                      </button>
                    </div>
                  </td>
                  <td className="p-2 text-right tabular-nums">{r.inStock}</td>
                  <td className="p-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{r.avgCostCents === null ? "" : formatCents(r.avgCostCents)}</td>
                  <td className="p-2 text-right tabular-nums">{r.marketCents === null ? "-" : formatCents(r.marketCents)}</td>
                  <td className="p-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{suggested === null ? "-" : formatCents(suggested)}</td>
                  <td className="p-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {state === "saving" && <span className="text-xs text-zinc-400 dark:text-zinc-500">...</span>}
                      {state === "error" && <span className="text-xs text-red-600 dark:text-red-400">!</span>}
                      <span className="text-zinc-400 dark:text-zinc-500">$</span>
                      <input
                        ref={(el) => {
                          if (el) inputs.current.set(r.productId, el);
                          else inputs.current.delete(r.productId);
                        }}
                        inputMode="decimal"
                        className={`w-24 rounded-md border px-2 py-1 text-right tabular-nums outline-none focus:border-zinc-900 dark:focus:border-zinc-100 focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-zinc-100/10 ${
                          state === "error" ? "border-red-500" : "border-zinc-300 dark:border-zinc-700"
                        }`}
                        placeholder={r.mixedPrices ? "mixed" : dollars(suggested)}
                        value={drafts[r.productId] ?? dollars(r.priceCents)}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.productId]: e.target.value }))}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void commit(r, i, true);
                          } else if (e.key === "Escape") {
                            setDrafts(({ [r.productId]: _, ...rest }) => rest);
                          } else if (e.key === "ArrowDown") {
                            e.preventDefault();
                            focusAt(i + 1);
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            focusAt(i - 1);
                          }
                        }}
                        onBlur={() => {
                          if (skipBlur.current === r.productId) {
                            skipBlur.current = null;
                            return;
                          }
                          if (drafts[r.productId] !== undefined) void commit(r, i, false);
                        }}
                      />
                    </div>
                    {r.priceCents !== null && r.marketCents ? (
                      <div className={`mt-0.5 text-xs tabular-nums ${Math.abs(r.priceCents / r.marketCents - 1) > 0.5 ? "font-medium text-amber-700 dark:text-amber-300" : "text-zinc-400 dark:text-zinc-500"}`}>
                        {Math.round((r.priceCents * 100) / r.marketCents)}% of market
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-zinc-500 dark:text-zinc-400">
                  {rows.length === 0 ? "Nothing in stock yet. Import a Collectr CSV first." : "Nothing matches this filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
