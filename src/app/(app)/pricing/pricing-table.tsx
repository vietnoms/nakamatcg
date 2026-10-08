"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Badge, Button, Input, Select } from "@/components/ui";
import { badgeFor } from "@/import/collectr";
import { formatCents, parseDollars } from "@/lib/money";
import { suggestPrice, type PricingRule } from "@/lib/pricing";
import type { PricingRow } from "@/server/inventory";
import { savePrice, savePrices } from "./actions";

type Filter = "all" | "unpriced" | "priced";

const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2).replace(/\.00$/, ""));

export function PricingTable({ rows: initial, rule }: { rows: PricingRow[]; rule: PricingRule }) {
  const [rows, setRows] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, "saving" | "error">>({});
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("unpriced");
  const [kind, setKind] = useState("");
  const [set, setSet] = useState("");
  const [bulkPending, startBulk] = useTransition();
  const inputs = useRef(new Map<string, HTMLInputElement>());
  // Enter moves focus on, which blurs the row it just saved: that blur must not save again
  const skipBlur = useRef<string | null>(null);

  const sets = useMemo(() => [...new Set(initial.map((r) => r.setName))].sort(), [initial]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (filter === "all" || (filter === "unpriced" ? r.priceCents === null : r.priceCents !== null)) &&
        (!kind || r.kind === kind) &&
        (!set || r.setName === set) &&
        (!needle || `${r.name} ${r.setName} ${r.cardNumber}`.toLowerCase().includes(needle)),
    );
    // the list is filtered once per filter change, not on every save, so a just-priced row stays put
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filter, kind, set, initial]);

  const totals = useMemo(
    () => ({
      unpriced: rows.filter((r) => r.priceCents === null).reduce((n, r) => n + r.inStock, 0),
      copies: rows.reduce((n, r) => n + r.inStock, 0),
    }),
    [rows],
  );

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
        <Button variant="secondary" onClick={acceptAllSuggested} disabled={bulkPending}>
          {bulkPending ? "Saving..." : "Accept suggested for unpriced in view"}
        </Button>
        <span className="ml-auto text-sm text-zinc-500">
          {totals.unpriced} of {totals.copies} copies unpriced
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
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
              const r = rows.find((x) => x.productId === v.productId) ?? v;
              const suggested = suggestPrice(r.marketCents, rule);
              const state = saving[r.productId];
              const badge = badgeFor(r);
              return (
                <tr key={r.productId} className="border-t border-zinc-100 align-middle">
                  <td className="p-2">
                    <div className="font-medium">
                      {r.name} {badge && <Badge tone={r.kind === "slab" ? "blue" : "zinc"}>{badge}</Badge>}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {[r.setName, r.cardNumber && `#${r.cardNumber}`, r.variant].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="p-2 text-right tabular-nums">{r.inStock}</td>
                  <td className="p-2 text-right tabular-nums text-zinc-500">{r.avgCostCents === null ? "" : formatCents(r.avgCostCents)}</td>
                  <td className="p-2 text-right tabular-nums">{r.marketCents === null ? "-" : formatCents(r.marketCents)}</td>
                  <td className="p-2 text-right tabular-nums text-zinc-500">{suggested === null ? "-" : formatCents(suggested)}</td>
                  <td className="p-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {state === "saving" && <span className="text-xs text-zinc-400">...</span>}
                      {state === "error" && <span className="text-xs text-red-600">!</span>}
                      <span className="text-zinc-400">$</span>
                      <input
                        ref={(el) => {
                          if (el) inputs.current.set(r.productId, el);
                          else inputs.current.delete(r.productId);
                        }}
                        inputMode="decimal"
                        className={`w-24 rounded-md border px-2 py-1 text-right tabular-nums outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 ${
                          state === "error" ? "border-red-500" : "border-zinc-300"
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
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-zinc-500">
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
