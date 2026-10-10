"use client";

import { useState, useTransition } from "react";
import { Button, Card, Input, Select } from "@/components/ui";
import type { ProductInput } from "@/lib/ops";
import { formatCents, parseDollars } from "@/lib/money";
import { suggestPrice, type PricingRule } from "@/lib/pricing";
import { CardLookup } from "@/pos/card-lookup";
import { addStockAction } from "./actions";

type Group = { id: string; name: string };

const BLANK: ProductInput = { kind: "sealed", name: "", setName: "", cardNumber: "", variant: "", condition: "NM", grader: "PSA", grade: "", cert: "", marketCents: null };
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];

/** Stock bought outside a show and outside Collectr (sealed from a distributor, mostly). */
export function AddStock({ groups, rule }: { groups: Group[]; rule: PricingRule }) {
  const [p, setP] = useState<ProductInput>(BLANK);
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [groupId, setGroupId] = useState<string>("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const n = Number.parseInt(qty, 10);
  const suggested = suggestPrice(p.marketCents, rule);
  const ok = p.name.trim() && Number.isFinite(n) && n >= 1 && n <= 500;

  function submit() {
    setError(null);
    setDone(null);
    start(async () => {
      try {
        const res = await addStockAction({
          product: { ...p, name: p.name.trim() },
          qty: n,
          costCents: parseDollars(cost),
          priceCents: price.trim() ? parseDollars(price) : null,
          groupId: groupId || null,
        });
        setDone(
          `Added ${res.codes.length} x ${p.name.trim()}${price.trim() ? ` at ${formatCents(parseDollars(price) ?? 0)}` : " (price it on the Pricing page)"}.${
            p.kind === "sealed" ? " Sell it on the POS with the Sealed button; no stickers needed." : " Its stickers are in the Stickers queue once priced."
          }`,
        );
        setP(BLANK);
        setQty("1");
        setCost("");
        setPrice("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add it");
      }
    });
  }

  return (
    <Card title="Add stock by hand">
      <div className="space-y-3 text-sm">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          For stock that isn&apos;t in Collectr and didn&apos;t come from a customer: sealed from a distributor, a store run. Search the price
          catalog (or take a photo), check the details, enter how many and what each cost.
        </p>
        <CardLookup
          onFill={(f) => {
            setP({ kind: f.kind, name: f.name, setName: f.setName, cardNumber: f.cardNumber, variant: f.variant, condition: "NM", grader: f.grader || "PSA", grade: f.grade, cert: f.cert, marketCents: f.marketCents });
            setPrice("");
          }}
        />
        <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
          {(["sealed", "raw", "slab"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setP({ ...p, kind: k })}
              className={`rounded px-3 py-1 ${p.kind === k ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950" : "text-zinc-600 dark:text-zinc-400"}`}
            >
              {k === "sealed" ? "Sealed" : k === "raw" ? "Raw card" : "Slab"}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input placeholder={p.kind === "sealed" ? "Product, e.g. Prismatic Evolutions Elite Trainer Box" : "Card name"} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} className="sm:col-span-2" />
          <Input placeholder="Set" value={p.setName} onChange={(e) => setP({ ...p, setName: e.target.value })} />
          {p.kind !== "sealed" && <Input placeholder="Number" value={p.cardNumber} onChange={(e) => setP({ ...p, cardNumber: e.target.value })} />}
          {p.kind === "raw" && (
            <Select value={p.condition} onChange={(e) => setP({ ...p, condition: e.target.value })}>
              {CONDITIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          )}
          {p.kind === "slab" && (
            <>
              <Input placeholder="Grader" value={p.grader} onChange={(e) => setP({ ...p, grader: e.target.value })} />
              <Input placeholder="Grade" value={p.grade} onChange={(e) => setP({ ...p, grade: e.target.value })} />
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5">
            Qty
            <Input type="number" min={1} max={500} value={qty} onChange={(e) => setQty(e.target.value)} className="w-20 text-right" />
          </label>
          <label className="flex items-center gap-1.5">
            Market $
            <Input
              inputMode="decimal"
              value={p.marketCents === null ? "" : (p.marketCents / 100).toFixed(2)}
              onChange={(e) => setP({ ...p, marketCents: parseDollars(e.target.value) })}
              className="w-24 text-right"
            />
          </label>
          <label className="flex items-center gap-1.5">
            Cost each $
            <Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="unknown" className="w-24 text-right" />
          </label>
          <label className="flex items-center gap-1.5">
            Price each $
            <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={suggested === null ? "later" : (suggested / 100).toFixed(0)} className="w-24 text-right" />
          </label>
          {suggested !== null && !price && (
            <button type="button" className="text-xs underline" onClick={() => setPrice((suggested / 100).toFixed(2))}>
              use {formatCents(suggested)}
            </button>
          )}
          <label className="flex items-center gap-1.5">
            Group
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">No group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <Button disabled={pending || !ok} onClick={submit}>
            {pending ? "Adding..." : `Add ${Number.isFinite(n) && n > 0 ? n : ""} to stock`}
          </Button>
          {done && <span className="text-green-700 dark:text-green-300">{done}</span>}
          {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
        </div>
      </div>
    </Card>
  );
}
