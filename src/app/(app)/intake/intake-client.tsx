"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Select } from "@/components/ui";
import { formatCents, parseDollars } from "@/lib/money";
import type { ProductInput } from "@/lib/ops";
import { suggestPrice, type PricingRule } from "@/lib/pricing";
import { CardLookup } from "@/pos/card-lookup";
import type { PendingDeal, PendingUnit } from "@/server/intake";
import { identifyAction, resplitAction } from "./actions";

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
const KIND: Record<string, string> = { sale: "Sale", buy: "Buy", trade: "Trade" };
const STATUS: Record<string, string> = { sold: "sold", traded_out: "traded away" };

function UnitForm({ unit, rule }: { unit: PendingUnit; rule: PricingRule }) {
  const router = useRouter();
  const blank: ProductInput = { kind: unit.kind as ProductInput["kind"], name: "", setName: "", cardNumber: "", variant: "", condition: "NM", grader: "PSA", grade: "", cert: "", marketCents: null };
  const [p, setP] = useState<ProductInput>(blank);
  const [price, setPrice] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const suggested = suggestPrice(p.marketCents, rule);
  const inStock = unit.status === "in_stock";

  function save() {
    setError(null);
    start(async () => {
      try {
        await identifyAction(unit.unitId, { ...p, name: p.name.trim() }, price.trim() ? parseDollars(price) : null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save it");
      }
    });
  }

  return (
    <li className="border-t border-zinc-200 py-3 first:border-0 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs">{unit.code}</span>
        <span className="font-medium">{unit.name}</span>
        {unit.note && <span className="text-zinc-500 dark:text-zinc-400">· {unit.note}</span>}
        <span className="text-zinc-500 dark:text-zinc-400">· cost {unit.costCents === null ? "-" : formatCents(unit.costCents)}</span>
        {!inStock && <span className="rounded bg-zinc-100 px-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{STATUS[unit.status] ?? unit.status}</span>}
        {!unit.pending && <span className="ml-auto text-green-700 dark:text-green-300">Identified</span>}
        {unit.pending && !open && (
          <Button variant="secondary" className="ml-auto" onClick={() => setOpen(true)}>
            Identify
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2 text-sm">
          <CardLookup
            onFill={(f) => {
              setP({ kind: f.kind, name: f.name, setName: f.setName, cardNumber: f.cardNumber, variant: f.variant, condition: "NM", grader: f.grader || "PSA", grade: f.grade, cert: f.cert, marketCents: f.marketCents });
              setPrice("");
            }}
          />
          <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
            {(["raw", "slab", "sealed"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setP({ ...p, kind: k })}
                className={`rounded px-3 py-1 ${p.kind === k ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950" : "text-zinc-600 dark:text-zinc-400"}`}
              >
                {k === "raw" ? "Raw card" : k === "slab" ? "Slab" : "Sealed"}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <Input placeholder="Card or product name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} className="sm:col-span-2" />
            <Input placeholder="Set" value={p.setName} onChange={(e) => setP({ ...p, setName: e.target.value })} />
            {p.kind !== "sealed" && <Input placeholder="Number" value={p.cardNumber} onChange={(e) => setP({ ...p, cardNumber: e.target.value })} />}
            {p.kind === "raw" && (
              <Select value={p.condition} onChange={(e) => setP({ ...p, condition: e.target.value })} aria-label="Condition">
                {CONDITIONS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            )}
            {p.kind === "slab" && (
              <>
                <Input placeholder="Grader" value={p.grader} onChange={(e) => setP({ ...p, grader: e.target.value })} />
                <Input placeholder="Grade" value={p.grade} onChange={(e) => setP({ ...p, grade: e.target.value })} />
                <Input placeholder="Cert" value={p.cert} onChange={(e) => setP({ ...p, cert: e.target.value })} />
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5">
              Market $
              <Input
                inputMode="decimal"
                value={p.marketCents === null ? "" : (p.marketCents / 100).toFixed(2)}
                onChange={(e) => setP({ ...p, marketCents: parseDollars(e.target.value) })}
                className="w-24 text-right"
              />
            </label>
            {inStock && (
              <label className="flex items-center gap-1.5">
                Price $
                <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={suggested === null ? "later" : (suggested / 100).toFixed(2)} className="w-24 text-right" />
              </label>
            )}
            <Button onClick={save} disabled={pending || !p.name.trim()}>
              {pending ? "Saving..." : "Save"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
    </li>
  );
}

export function IntakeDeal({ deal, rule }: { deal: PendingDeal & { when: string }; rule: PricingRule }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card title={`${KIND[deal.kind] ?? deal.kind}, ${deal.when}${deal.eventName ? ` · ${deal.eventName}` : ""} · ${deal.units.filter((u) => u.pending).length || "none"} to identify`}>
      {deal.photoIds.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {deal.photoIds.map((id) => (
            <a key={id} href={`/api/deal-photos/${id}`} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/deal-photos/${id}`} alt="Deal photo" className="h-32 w-32 rounded object-cover" />
            </a>
          ))}
        </div>
      )}
      <ul>
        {deal.units.map((u) => (
          <UnitForm key={u.unitId} unit={u} rule={rule} />
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const n = await resplitAction(deal.dealId);
              setNote(n ? `Re-split ${n} card${n === 1 ? "" : "s"}' cost by market.` : "Nothing to change.");
              router.refresh();
            })
          }
        >
          Re-split cost by market
        </Button>
        {note && <span className="text-green-700 dark:text-green-300">{note}</span>}
      </div>
    </Card>
  );
}
